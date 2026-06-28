import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
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
  private readonly logger = new Logger(ItemGenerationService.name);

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
    // load every existing question stem once, so we can skip exact duplicates
    const seen = new Set<string>();
    const existing = await this.prisma.draftItem.findMany({ select: { stem: true } });
    for (const e of existing) seen.add(this.normStem(e.stem));
    let duplicates = 0;
    let firstError = '';
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
        const saved = await this.persistDrafts(batchId, base, items, createdBy, seen);
        duplicates += saved.skipped;
        this.logger.log(`seed ok: parsed ${items.length}, saved ${saved.saved}, skipped ${saved.skipped}`);
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (!firstError) firstError = msg;
        this.logger.error(`seed FAILED: ${String((err as Error)?.stack ?? msg)}`);
      }
      await this.prisma.batchJob.update({
        where: { id: jobId },
        data: { done: { increment: versions }, duplicates },
      });
    }
    const summary = await this.validation.validateBatch(batchId);
    await this.prisma.batchJob.update({
      where: { id: jobId },
      data: { status: 'done', passed: summary.passed, failed: summary.failed, duplicates, error: firstError || null },
    });
  }

  getJob(jobId: string) {
    return this.prisma.batchJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  /** normalize a stem for exact-duplicate comparison */
  private normStem(s: string): string {
    return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Persist generated items, skipping any whose stem exactly matches one already
   * seen (in the DB or earlier in this run). Returns how many were skipped.
   */
  private async persistDrafts(
    batchId: string,
    base: BaseItem,
    items: GeneratedItem[],
    createdBy: string,
    seen: Set<string>,
  ): Promise<{ saved: number; skipped: number }> {
    if (!Array.isArray(items) || !items.length) return { saved: 0, skipped: 0 };
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const it of items) {
      const conv = it.figure ? { stem: it.stem, figure: null } : this.tableToFigure(it.stem);
      const key = this.normStem(conv.stem);
      if (!key || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const options = this.normalizeOptions(it.options);
      rows.push({
        batchId,
        baseSourceId: base.sourceId ?? base.stem.slice(0, 40),
        status: 'draft',
        versionType: String(it.versionType ?? 'item'),
        stem: String(conv.stem ?? ''),
        figure: (it.figure as object) ?? conv.figure ?? undefined,
        options: options as unknown as object,
        answer: it.answer === undefined || it.answer === null ? '' : String(it.answer),
        solution: String(it.solution ?? ''),
        standard: String(it.standard ?? base.standard ?? ''),
        ga: it.ga ?? base.ga ?? undefined,
        gaCluster: it.gaCluster ?? base.gaCluster ?? undefined,
        skillTags: Array.isArray(it.skillTags) ? it.skillTags.map(String) : [],
        skillNode: it.skillNode ?? undefined,
        misconceptionTags: Array.isArray(it.misconceptionTags) ? it.misconceptionTags.map(String) : [],
        dok: typeof it.dok === 'number' ? it.dok : 2,
        difficulty: String(it.difficulty ?? 'Medium'),
        microDiagnosticSignal: String(it.microDiagnosticSignal ?? ''),
        provenance: 'AIG',
        createdBy,
      });
    }
    if (rows.length) await this.prisma.draftItem.createMany({ data: rows as never });
    return { saved: rows.length, skipped };
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
    // shuffle so the correct answer isn't always option A (Fisher-Yates)
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
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

  /** Delete all non-operational items (draft/validated/field_test/rejected). Never deletes operational. */
  async clearDrafts(): Promise<{ deleted: number }> {
    const res = await this.prisma.draftItem.deleteMany({
      where: { status: { not: 'operational' } },
    });
    return { deleted: res.count };
  }

  // ---- parsers (paste/CSV minimal; PDF extractor is a follow-up) ----
  private parseModelJson(raw: string): unknown[] {
    const s = raw.indexOf('[');
    const e = raw.lastIndexOf(']');
    if (s < 0 || e < 0) return [];
    return JSON.parse(raw.slice(s, e + 1));
  }
}
