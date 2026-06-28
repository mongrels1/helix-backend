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

  /**
   * Extract a clean list of question stems from raw text (pasted, or pulled from
   * a PDF on the client). Uses the AI to handle messy PDF/OCR layout. Returns
   * just the question strings — the caller picks the standard at generate time.
   */
  async ingest(_format: 'pdf' | 'csv' | 'paste', payload: { text?: string }) {
    const text = (payload.text ?? '').trim();
    if (!text) {
      throw new BadRequestException({ error: { code: 'no_text', message: 'No text provided' } });
    }
    const res = await this.ai.chat({
      systemPrompt:
        'You extract math questions from raw text that is often messy (copied from a PDF or OCR). ' +
        'Return ONLY a JSON array of strings. Each string is ONE complete, self-contained question, ' +
        'copied close to verbatim, on a single line with no internal line breaks. ' +
        'Drop multiple-choice options, item numbers, headers, answer keys, and anything that is not a question. ' +
        'If a question depends on a missing image or is unreadable, skip it. No prose outside the JSON.',
      prompt: text.slice(0, 24000),
      preferredProvider: 'claude',
      timeoutMs: 45_000,
      maxTokens: 4000,
    });
    const questions = (this.parseModelJson(res.text) as unknown[])
      .map((q) => String(q).replace(/\s+/g, ' ').trim())
      .filter((q) => q.length > 8);
    return { questions, parsed: questions.length };
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
      data: items.map((it) => {
        const conv = it.figure ? { stem: it.stem, figure: null } : this.tableToFigure(it.stem);
        const options = this.normalizeOptions(it.options);
        return {
        batchId,
        baseSourceId: base.sourceId ?? base.stem.slice(0, 40),
        status: 'draft' as const,
        versionType: it.versionType,
        stem: conv.stem,
        figure: (it.figure as object) ?? conv.figure ?? undefined,
        options: options as unknown as object,
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
        };
      }),
    });
  }

  /**
   * Safety net: if the model put a 2-column Markdown table inside the stem,
   * lift it into a ratio_table figure and leave the stem as a plain sentence.
   * Only fires when there's a clear "| --- |" separator row.
   */
  /**
   * Guarantee exactly one correct option. Models sometimes tag the 3 distractors
   * but forget to flag the answer; the lone untagged option is the answer. Also
   * clears any tag off the correct option and keeps only the first if several are
   * marked correct.
   */
  private normalizeOptions(
    raw: unknown,
  ): { text: string; correct: boolean; misconception?: string; misconceptionTag: string }[] {
    const arr = Array.isArray(raw) ? raw : [];
    const opts = arr.map((o: { text?: string; correct?: boolean; misconception?: string; misconceptionTag?: string }) => ({
      text: String(o?.text ?? ''),
      correct: o?.correct === true,
      misconception: o?.misconception ? String(o.misconception) : undefined,
      misconceptionTag: o?.misconceptionTag ? String(o.misconceptionTag) : '',
    }));
    const correctCount = opts.filter((o) => o.correct).length;
    if (correctCount === 0) {
      const untagged = opts.filter((o) => !o.misconceptionTag);
      if (untagged.length === 1) untagged[0].correct = true;
    } else if (correctCount > 1) {
      let seen = false;
      for (const o of opts) {
        if (o.correct && seen) o.correct = false;
        else if (o.correct) seen = true;
      }
    }
    for (const o of opts) if (o.correct) o.misconceptionTag = '';
    return opts;
  }

  private tableToFigure(stem: string): { stem: string; figure: Record<string, unknown> | null } {
    if (!/\|\s*-{2,}/.test(stem)) return { stem, figure: null };
    const start = stem.indexOf('|');
    if (start < 0) return { stem, figure: null };
    const head = stem.slice(0, start).trim();
    const cells = stem.slice(start).split('|').map((c) => c.trim()).filter((c) => c !== '');
    const dashCells = cells.filter((c) => /^-+$/.test(c));
    if (dashCells.length !== 2) return { stem, figure: null }; // only 2-column tables
    const nonDash = cells.filter((c) => !/^-+$/.test(c));
    if (nonDash.length < 4) return { stem, figure: null };
    const headers = [nonDash[0], nonDash[1]];
    const data = nonDash.slice(2);
    const rows: { a: string; b: string }[] = [];
    for (let i = 0; i + 1 < data.length; i += 2) rows.push({ a: data[i], b: data[i + 1] });
    if (!rows.length) return { stem, figure: null };
    return {
      stem: head || stem,
      figure: { type: 'ratio_table', headers, rows, altText: `${headers[0]} to ${headers[1]} table` },
    };
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
    const page = Number(q.page) || 1;
    const pageSize = Math.min(Number(q.pageSize) || 25, 1000);
    return this.prisma.draftItem.findMany({
      where: {
        status: (q.status as never) || undefined,
        batchId: q.batchId || undefined,
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    });
  }

  item(id: string) {
    return this.prisma.draftItem.findUniqueOrThrow({ where: { id } });
  }

  // ---- parsers (paste/CSV minimal; PDF extractor is a follow-up) ----
  private parseModelJson(raw: string): unknown[] {
    const s = raw.indexOf('[');
    const e = raw.lastIndexOf(']');
    if (s < 0 || e < 0) return [];
    return JSON.parse(raw.slice(s, e + 1));
  }
}
