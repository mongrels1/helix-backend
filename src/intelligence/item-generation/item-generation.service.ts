import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIRouterService } from '../ai-router/ai-router.service';
import { ValidationService } from './validation.service';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import { resolveStandard } from './mgse-ga-crosswalk';
import { applicableMisconceptions } from './misconception-library';
import type { BaseItem, GenerateRequest, GeneratedItem } from './types';

const PROMOTE_MIN_RESPONSES = 200;

/**
 * Orchestrates: ingest (seed -> BaseItem[], reference only) -> generate
 * (background, scales to ~50 seeds) -> review -> promote. Generated items live
 * in their own DraftItem table; they are never the live diagnostic ruler.
 */
@Injectable()
export class ItemGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIRouterService,
    private readonly validation: ValidationService,
  ) {}

  async ingest(
    format: 'pdf' | 'csv' | 'paste',
    payload: { text?: string; buffer?: Buffer },
  ) {
    let baseItems: BaseItem[];
    if (format === 'paste' || format === 'csv') {
      baseItems = this.parseText(payload.text ?? '');
    } else {
      baseItems = await this.parsePdf(payload.buffer);
    }
    if (!baseItems.length) {
      throw new BadRequestException({ error: { code: 'no_items', message: 'No items parsed' } });
    }
    for (const b of baseItems) {
      const r = resolveStandard(b.standard);
      b.ga = r.ga;
      b.gaCluster = r.gaCluster;
      b.referenceOnly = true;
    }
    return { baseItems, parsed: baseItems.length, harvestedMisconceptions: 0, warnings: [] as string[] };
  }

  /** Kick off generation in the background; returns immediately with a jobId to poll. */
  async generate(req: GenerateRequest, createdBy: string) {
    if (!req.baseItems?.length) {
      throw new BadRequestException({ error: { code: 'no_items', message: 'baseItems empty' } });
    }
    const versions = Math.min(Math.max(req.versionsPerItem ?? 5, 5), 10);
    const batchId = `batch-${Date.now()}`;
    const total = req.baseItems.length * versions;
    const job = await this.prisma.batchJob.create({
      data: { batchId, status: 'running', total, done: 0, createdBy },
    });

    void this.processBatch(job.id, batchId, req, versions, createdBy).catch((err) =>
      this.prisma.batchJob.update({
        where: { id: job.id },
        data: { status: 'failed', error: String(err?.message ?? err) },
      }),
    );

    return { batchId, jobId: job.id, status: 'queued', count: total };
  }

  private async processBatch(
    jobId: string,
    batchId: string,
    req: GenerateRequest,
    versions: number,
    createdBy: string,
  ): Promise<void> {
    for (const base of req.baseItems) {
      const route = resolveStandard(base.standard);
      const misIds = [
        ...applicableMisconceptions(route.ga),
        ...applicableMisconceptions(route.gaCluster),
      ].map((m) => m.id);
      const user = buildUserPrompt({
        base,
        versions,
        figureType: route.figure,
        misconceptionIds: [...new Set(misIds)],
      });
      try {
        const res = await this.ai.chat({
          systemPrompt: SYSTEM_PROMPT,
          prompt: user,
          preferredProvider: 'claude',
          timeoutMs: 45_000,
          maxTokens: 4000,
        });
        const items = this.parseModelJson(res.text) as GeneratedItem[];
        await this.persistDrafts(batchId, base, items, createdBy);
      } catch {
        // one bad seed shouldn't kill the batch
      }
      await this.prisma.batchJob.update({
        where: { id: jobId },
        data: { done: { increment: versions } },
      });
    }
    const summary = await this.validation.validateBatch(batchId);
    await this.prisma.batchJob.update({
      where: { id: jobId },
      data: { status: 'done', passed: summary.passed, failed: summary.failed },
    });
  }

  getJob(jobId: string) {
    return this.prisma.batchJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  private async persistDrafts(
    batchId: string,
    base: BaseItem,
    items: GeneratedItem[],
    createdBy: string,
  ): Promise<void> {
    if (!Array.isArray(items) || !items.length) return;
    await this.prisma.draftItem.createMany({
      data: items.map((it) => ({
        batchId,
        baseSourceId: base.sourceId ?? base.stem.slice(0, 40),
        status: 'draft' as const,
        versionType: it.versionType,
        stem: it.stem,
        figure: (it.figure as object) ?? undefined,
        options: it.options as unknown as object,
        answer: String(it.answer),
        solution: it.solution,
        standard: it.standard ?? base.standard,
        ga: it.ga ?? base.ga,
        gaCluster: it.gaCluster ?? base.gaCluster,
        skillTags: it.skillTags ?? [],
        skillNode: it.skillNode,
        misconceptionTags: it.misconceptionTags ?? [],
        dok: it.dok ?? 2,
        difficulty: it.difficulty ?? 'Medium',
        microDiagnosticSignal: it.microDiagnosticSignal ?? '',
        provenance: 'AIG',
        createdBy,
      })),
    });
  }

  async review(
    id: string,
    action: 'approve' | 'reject' | 'edit',
    edits?: Partial<GeneratedItem>,
  ) {
    const item = await this.prisma.draftItem.findUniqueOrThrow({ where: { id } });
    if (action === 'approve') {
      if (item.status !== 'validated') {
        throw new ConflictException({
          error: { code: 'not_validated', message: 'Item must pass validation before approval' },
        });
      }
      return this.prisma.draftItem.update({ where: { id }, data: { status: 'field_test' } });
    }
    if (action === 'reject') {
      return this.prisma.draftItem.update({ where: { id }, data: { status: 'rejected' } });
    }
    return this.prisma.draftItem.update({
      where: { id },
      data: { ...(edits as object), status: 'draft' },
    });
  }

  /** The only path to operational (scored). Gated on calibration. */
  async promote(id: string) {
    const item = await this.prisma.draftItem.findUniqueOrThrow({ where: { id } });
    const cal = (item.calibration as { responses?: number; difFlag?: boolean } | null) ?? { responses: 0 };
    if ((cal.responses ?? 0) < PROMOTE_MIN_RESPONSES || cal.difFlag) {
      throw new ConflictException({
        error: { code: 'not_calibrated', message: 'Item is not calibrated', details: cal },
      });
    }
    return this.prisma.draftItem.update({ where: { id }, data: { status: 'operational' } });
  }

  queue(q: { status?: string; batchId?: string; page?: number; pageSize?: number }) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    return this.prisma.draftItem.findMany({
      where: { status: q.status as never, batchId: q.batchId },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    });
  }

  item(id: string) {
    return this.prisma.draftItem.findUniqueOrThrow({ where: { id } });
  }

  // ---- parsers (paste/CSV minimal; PDF extractor is a follow-up) ----
  private parseText(text: string): BaseItem[] {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((stem) => ({ stem, standard: 'MGSE6.RP.3', referenceOnly: true }));
  }
  private async parsePdf(_buf?: Buffer): Promise<BaseItem[]> {
    return [];
  }
  private parseModelJson(raw: string): unknown[] {
    const s = raw.indexOf('[');
    const e = raw.lastIndexOf(']');
    if (s < 0 || e < 0) return [];
    return JSON.parse(raw.slice(s, e + 1));
  }
}
