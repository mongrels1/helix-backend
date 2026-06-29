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
import { nodesForStandard } from './skill-graph';
import { applicableMisconceptions } from './misconception-library';
import { buildIntegrityReport, type BankRow } from './integrity';
import { DIAGNOSTIC_ITEM_BANK } from '../remediation/diagnostic-item-bank';
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

  /**
   * No-seed ("quick") generation. Synthesizes seed prompts for a standard from
   * the skill graph (falling back to one generic seed) and runs them through the
   * normal generate pipeline — so a super-admin can top up a standard's practice
   * pool without pasting examples. Same validation + dedup as seeded generation.
   */
  async generateFromStandard(
    body: { standard: string; grade?: number; count?: number },
    createdBy: string,
  ) {
    const standard = String(body.standard ?? '').trim();
    if (!standard) {
      throw new BadRequestException({ error: { code: 'no_standard', message: 'standard required' } });
    }
    const route = resolveStandard(standard);
    const count = Math.min(Math.max(Number(body.count) || 10, 5), 50);
    const gradeStr = body.grade ? `Grade ${body.grade} ` : '';

    const nodes = [
      ...nodesForStandard(standard),
      ...nodesForStandard(route.ga),
      ...nodesForStandard(route.gaCluster),
    ];
    const seenNode = new Set<string>();
    const uniqueNodes = nodes.filter((n) => (seenNode.has(n.id) ? false : (seenNode.add(n.id), true)));

    // Generate in FULL 10-version slates so each slate carries the whole
    // representation set (fractions, decimals, percent, figure, psychology, …).
    // Volume is controlled by how many slates we run, not by shrinking a slate.
    const slateSize = 10;
    const numSlates = Math.min(Math.max(Math.ceil(count / slateSize), 1), 6);
    const seeds: BaseItem[] = Array.from({ length: numSlates }, (_, i) => {
      const node = uniqueNodes.length ? uniqueNodes[i % uniqueNodes.length] : null;
      return {
        // unique per slate so validateBatch gates each slate separately
        sourceId: node ? `std:${route.ga}:${node.id}:${i}` : `std:${route.ga}:${i}`,
        standard,
        ga: route.ga,
        gaCluster: route.gaCluster,
        stem: node
          ? `Write an original ${gradeStr}word problem for ${route.ga} — ${node.label}. ${node.masteryIndicator} Use a realistic, fresh scenario with a single correct answer.`
          : `Write an original ${gradeStr}word problem aligned to standard ${route.ga}. Use a realistic, fresh scenario with a single correct numeric or short-text answer.`,
        referenceOnly: true,
      } as BaseItem;
    });

    return this.generate({ baseItems: seeds, versionsPerItem: slateSize }, createdBy);
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
          timeoutMs: 60_000,
          // A full 10-version slate with answers, solutions, and figures is large;
          // 4000 truncated the JSON mid-array. 8000 gives the slate room to finish.
          maxTokens: 8000,
        });
        const items = this.parseModelJson(res.text) as GeneratedItem[];
        const saved = await this.persistDrafts(batchId, base, items, createdBy, seen, [...new Set(misIds)]);
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
    fallbackTags: string[] = [],
  ): Promise<{ saved: number; skipped: number }> {
    if (!Array.isArray(items) || !items.length) return { saved: 0, skipped: 0 };
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    // Resolve the standard once so we can backfill ga / gaCluster when the model
    // (or a seed) leaves them blank — keeps targeted-practice routing intact.
    const resolved = resolveStandard(String(base.standard || ''));
    for (const it of items) {
      const conv = it.figure ? { stem: it.stem, figure: null } : this.tableToFigure(it.stem);
      const key = this.normStem(conv.stem);
      if (!key || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      const options = this.normalizeOptions(it.options);
      // Every distractor must carry a valid misconception tag. The model
      // occasionally leaves one blank; fill it from this standard's applicable
      // misconceptions (falling back to a generic computation error) so the item
      // is never flagged "untagged distractor".
      let fbIdx = 0;
      for (const o of options) {
        if (!o.correct && !o.misconceptionTag) {
          o.misconceptionTag = fallbackTags.length
            ? fallbackTags[fbIdx % fallbackTags.length]
            : 'RP.COMPUTATION_ERROR';
          fbIdx++;
        }
      }
      // Safety net: the model sometimes omits the top-level "answer" even though
      // it flags the correct option. Fall back to that option's text so the item
      // never persists answer-less. Standard is stored in the base's MGSE form so
      // practice routing (strandOfStandard) can resolve the strand.
      const correctOpt = options.find((o) => o.correct);
      const rawAnswer = it.answer === undefined || it.answer === null ? '' : String(it.answer).trim();
      const answer = rawAnswer || (correctOpt ? correctOpt.text : '');
      rows.push({
        batchId,
        baseSourceId: base.sourceId ?? base.stem.slice(0, 40),
        status: 'draft',
        versionType: String(it.versionType ?? 'item'),
        stem: String(conv.stem ?? ''),
        figure: (it.figure as object) ?? conv.figure ?? undefined,
        options: options as unknown as object,
        answer,
        solution: String(it.solution ?? ''),
        standard: String(base.standard || it.standard || ''),
        ga: it.ga || base.ga || resolved.ga || undefined,
        gaCluster: it.gaCluster || base.gaCluster || resolved.gaCluster || undefined,
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

  /**
   * Whole-bank integrity report for the Super-Admin "Verify Database" gate run
   * before opening sales. Pulls every DraftItem (only the fields the report
   * needs) and runs the pure aggregator in integrity.ts.
   */
  async integrity() {
    const rows = (await this.prisma.draftItem.findMany({
      select: {
        id: true,
        status: true,
        standard: true,
        ga: true,
        gaCluster: true,
        skillTags: true,
        misconceptionTags: true,
        options: true,
        stem: true,
        answer: true,
        solution: true,
        dok: true,
        difficulty: true,
      },
    })) as unknown as BankRow[];
    return buildIntegrityReport(rows, DIAGNOSTIC_ITEM_BANK);
  }

  /**
   * Repair existing items that were saved without a GA cluster (e.g. older seeded
   * batches). Resolves the cluster from each item's standard. One-time cleanup
   * surfaced as a Super-Admin button; safe to run repeatedly.
   */
  async backfillClusters(): Promise<{ updated: number }> {
    const items = await this.prisma.draftItem.findMany({
      where: { OR: [{ gaCluster: null }, { gaCluster: '' }] },
      select: { id: true, standard: true, ga: true },
    });
    let updated = 0;
    for (const it of items) {
      const r = resolveStandard(String(it.standard || it.ga || ''));
      if (!r.gaCluster) continue;
      await this.prisma.draftItem.update({
        where: { id: it.id },
        data: { gaCluster: r.gaCluster, ga: it.ga || r.ga || undefined },
      });
      updated++;
    }
    return { updated };
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
    if (s < 0) return [];
    const body = raw.slice(s);
    // Happy path: a complete array.
    const e = body.lastIndexOf(']');
    if (e >= 0) {
      try {
        return JSON.parse(body.slice(0, e + 1));
      } catch {
        // fall through to salvage (truncated / malformed tail)
      }
    }
    // Salvage: recover every complete top-level {...} object, so a slate that was
    // cut off mid-array still yields its finished items instead of failing wholesale.
    return this.salvageObjects(body);
  }

  /** Extract complete top-level JSON objects from a possibly-truncated array body. */
  private salvageObjects(body: string): unknown[] {
    const out: unknown[] = [];
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        if (depth > 0) depth--;
        if (depth === 0 && start >= 0) {
          try {
            out.push(JSON.parse(body.slice(start, i + 1)));
          } catch {
            // skip an object we can't parse
          }
          start = -1;
        }
      }
    }
    return out;
  }
}
