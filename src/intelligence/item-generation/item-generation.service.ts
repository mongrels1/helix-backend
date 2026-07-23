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
import { g6SeedForStandard } from './g6-seed';
import { g7SeedForStandard } from './g7-seed';
import { buildIntegrityReport, type BankRow, type DiagnosticRow } from './integrity';
import { figureIsSane, stemReferencesFigure, solutionLeaksReasoning, stemNotSelfContained } from './reliability-gate';
import { judgeItem } from './item-judge';
import { isRenderableFigure } from '../figures/figure-contract';
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
    // Extract each question WITH the standard code printed beside it and whether it
    // is a visual item, so generation can align each seed to its OWN standard/grade
    // (no forced global standard) and preserve tables/graphs/figures (CRA) instead
    // of flattening to words-only.
    const system =
      'You extract math questions from raw text that is often messy (copied from a PDF or OCR). ' +
      'Return ONLY a JSON array of objects, one per question: {"question": string, "standard": string, "visual": boolean}. ' +
      '"question" is ONE complete, self-contained question copied close to verbatim, on a single line with no ' +
      'internal line breaks; drop the multiple-choice options, item numbers, headers, and answer keys. ' +
      '"standard" is the standard code printed with that item if present (e.g. "MGSE8.F.5", "MGSE7.RP.3", or "8.FGR.5"), else "". ' +
      '"visual" is true if the item refers to or needs a table, graph, chart, coordinate plane, number line, diagram, ' +
      'or geometric figure (e.g. it mentions "the graph", "the table", "shown below", or is a geometry item), else false. ' +
      'If a question is unreadable, skip it. No prose outside the JSON.';

    // A full item bank (e.g. a 48-page DnA export) runs ~120k+ characters. The old
    // single call read only text.slice(0, 24000) — the first ~19% — so a 50-question
    // bank yielded ~20. Window the whole document (with a small overlap so a question
    // straddling a boundary isn't lost) and merge+dedup the results so ALL questions
    // come through. A generous cap bounds runaway cost on very large uploads.
    const CHUNK = 20_000;
    const OVERLAP = 800;
    const MAX_CHUNKS = 24; // ~460k chars — well beyond a full grade-level bank
    const windows: string[] = [];
    for (let i = 0; i < text.length && windows.length < MAX_CHUNKS; i += CHUNK - OVERLAP) {
      windows.push(text.slice(i, i + CHUNK));
    }

    const collected: { stem: string; standard: string; visual: boolean }[] = [];
    for (const win of windows) {
      try {
        const res = await this.ai.chat({
          systemPrompt: system,
          prompt: win,
          preferredProvider: 'claude',
          timeoutMs: 45_000,
          maxTokens: 8000,
        });
        for (const raw of this.parseModelJson(res.text) as unknown[]) {
          const o = raw as { question?: unknown; standard?: unknown; visual?: unknown };
          const stem = String(o?.question ?? '').replace(/\s+/g, ' ').trim();
          if (!stem) continue;
          collected.push({
            stem,
            standard: String(o?.standard ?? '').replace(/\s+/g, '').trim(),
            visual: o?.visual === true,
          });
        }
      } catch (err) {
        // One bad window shouldn't sink the whole upload — keep what the others found.
        this.logger.warn(`ingest window failed: ${String((err as Error)?.message ?? err)}`);
      }
    }

    // Case-insensitive dedup (overlap regions repeat a question) while preserving order.
    const seen = new Set<string>();
    const questions: { stem: string; standard: string; visual: boolean }[] = [];
    for (const q of collected) {
      if (q.stem.length <= 8) continue;
      const key = q.stem.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push(q);
    }
    return { questions, parsed: questions.length };
  }

  /** Kick off generation in the background; returns immediately with a jobId to poll. */
  async generate(req: GenerateRequest, createdBy: string) {
    if (!req.baseItems?.length) {
      throw new BadRequestException({ error: { code: 'no_items', message: 'baseItems empty' } });
    }
    // Single-job lock: refuse to start a new batch while one is already running, so an
    // accidental double-click (or clicking both generators) can't double the AI cost.
    // Stale jobs (>20 min without an update — e.g. a crashed run) are ignored so
    // generation can never be locked out permanently.
    const activeSince = new Date(Date.now() - 20 * 60 * 1000);
    const running = await this.prisma.batchJob.findFirst({
      where: { status: 'running', updatedAt: { gt: activeSince } },
      orderBy: { createdAt: 'desc' },
    });
    if (running) {
      throw new ConflictException({
        error: {
          code: 'batch_running',
          message: 'A generation batch is already running. Wait for it to finish before starting another.',
          details: { batchId: running.batchId, done: running.done, total: running.total },
        },
      });
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
    const seeds = this.buildSeedsForStandard(standard, body.grade, Number(body.count) || 10);
    return this.generate({ baseItems: seeds, versionsPerItem: 10 }, createdBy);
  }

  /**
   * Build full 10-version slate seeds for one standard from its skill graph.
   * Volume is controlled by how many slates we run, not by shrinking a slate, so
   * each slate carries the whole representation set (fractions, decimals, …).
   */
  private buildSeedsForStandard(standard: string, grade: number | undefined, count: number): BaseItem[] {
    const route = resolveStandard(standard);
    const c = Math.min(Math.max(Number(count) || 10, 5), 50);
    const gradeStr = grade ? `Grade ${grade} ` : '';
    const nodes = [
      ...nodesForStandard(standard),
      ...nodesForStandard(route.ga),
      ...nodesForStandard(route.gaCluster),
    ];
    const seenNode = new Set<string>();
    const uniqueNodes = nodes.filter((n) => (seenNode.has(n.id) ? false : (seenNode.add(n.id), true)));
    const slateSize = 10;
    const numSlates = Math.min(Math.max(Math.ceil(c / slateSize), 1), 6);
    // Curated G6 seed (Illuminate-derived misconception patterns + DOK-gap target).
    // Reference-only: seeds distractor rationales into the prompt so generated
    // items inherit real, documented student errors and fill the DOK-3/4 gap.
    const seed =
      g6SeedForStandard(standard) ??
      g7SeedForStandard(standard) ??
      g6SeedForStandard(route.ga || '') ??
      g7SeedForStandard(route.ga || '');
    const dokNote =
      seed && (seed.dokGap.dok3 > 0 || seed.dokGap.dok4 > 0)
        ? ` Emphasize higher-rigor DOK 3${seed.dokGap.dok4 > 0 ? '–4' : ''} versions (multi-step reasoning, modeling, interpret/justify) to fill the rigor gap.`
        : '';
    return Array.from({ length: numSlates }, (_, i) => {
      const node = uniqueNodes.length ? uniqueNodes[i % uniqueNodes.length] : null;
      // Rotate through the curated misconceptions so different slates surface
      // different documented errors as seed distractor rationales.
      const seedOptions =
        seed && seed.misconceptions.length
          ? [
              { text: '(correct answer varies by context)', correct: true, misconceptionTag: '' },
              ...Array.from({ length: 3 }, (_, k) => seed.misconceptions[(i * 3 + k) % seed.misconceptions.length])
                .filter(Boolean)
                .map((m) => ({ text: '(distractor)', correct: false, misconception: m, misconceptionTag: '' })),
            ]
          : undefined;
      return {
        sourceId: node ? `std:${route.ga}:${node.id}:${i}` : `std:${route.ga}:${i}`,
        standard,
        ga: route.ga,
        gaCluster: route.gaCluster,
        stem: (node
          ? `Write an original ${gradeStr}word problem for ${route.ga} — ${node.label}. ${node.masteryIndicator} Use a realistic, fresh scenario with a single correct answer.`
          : `Write an original ${gradeStr}word problem aligned to standard ${route.ga}. Use a realistic, fresh scenario with a single correct numeric or short-text answer.`) + dokNote,
        options: seedOptions,
        referenceOnly: true,
      } as BaseItem;
    });
  }

  /**
   * Fan out generation across many standards in one batch — fills the practice
   * bank broadly with net-new items (dedup still skips repeats). One job covers
   * every standard supplied.
   */
  async generateAllStandards(
    body: { standards: string[]; countPerStandard?: number },
    createdBy: string,
  ) {
    const standards = (body.standards ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (!standards.length) {
      throw new BadRequestException({ error: { code: 'no_standards', message: 'standards required' } });
    }
    const count = Math.min(Math.max(Number(body.countPerStandard) || 5, 5), 20);
    const seeds: BaseItem[] = [];
    for (const std of standards) seeds.push(...this.buildSeedsForStandard(std, undefined, count));
    return this.generate({ baseItems: seeds, versionsPerItem: 10 }, createdBy);
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
    let discarded = 0;
    let firstError = '';
    for (const base of req.baseItems) {
      const route = resolveStandard(base.standard);
      const misIds = [
        ...applicableMisconceptions(route.ga),
        ...applicableMisconceptions(route.gaCluster),
      ].map((m) => m.id);
      try {
        // Validate-and-regenerate: produce `versions` items that pass the shared
        // quality gates, re-prompting for the shortfall with fix-notes instead of
        // shipping duds.
        const items = await this.generateSlate(
          base,
          versions,
          route.figure,
          [...new Set(misIds)],
        );
        // Correctness self-check: independently re-solve each item and drop any
        // that is wrong, ambiguous, or malformed BEFORE it can be saved/served.
        const { kept, dropped } = await this.verifyItems(items);
        discarded += dropped;
        const saved = await this.persistDrafts(batchId, base, kept, createdBy, seen, [...new Set(misIds)]);
        duplicates += saved.skipped;
        discarded += saved.invalid;
        this.logger.log(`seed ok: parsed ${items.length}, verified ${kept.length}, discarded ${dropped + saved.invalid}, saved ${saved.saved}, skipped ${saved.skipped}`);
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        if (!firstError) firstError = msg;
        this.logger.error(`seed FAILED: ${String((err as Error)?.stack ?? msg)}`);
      }
      await this.prisma.batchJob.update({
        where: { id: jobId },
        data: { done: { increment: versions }, duplicates, discarded },
      });
    }
    const summary = await this.validation.validateBatch(batchId);
    // Self-heal: auto-reject any structurally-invalid serveable items (including
    // ones from older batches) so they stop reaching students.
    const purged = await this.purgeInvalidDrafts();
    await this.prisma.batchJob.update({
      where: { id: jobId },
      data: { status: 'done', passed: summary.passed, failed: summary.failed, duplicates, discarded: discarded + purged.count, error: firstError || null },
    });
  }

  /**
   * Generate a slate of `versions` items for one base with a bounded
   * validate-and-regenerate loop: each attempt is checked by the shared quality
   * guards (clean solution, sound/present figure, well-formed options); good
   * items are kept, and the specific failures are fed back as fix-notes to
   * re-prompt ONLY for the shortfall. After MAX_ROUNDS we return whatever passed
   * rather than shipping duds — this is what makes the generator produce correct
   * items instead of just fewer.
   */
  private async generateSlate(
    base: BaseItem,
    versions: number,
    figureType: string | null,
    misconceptionIds: string[],
  ): Promise<GeneratedItem[]> {
    const MAX_ROUNDS = 3;
    const good: GeneratedItem[] = [];
    let fixNotes: string[] = [];
    for (let round = 0; round < MAX_ROUNDS && good.length < versions; round++) {
      const need = versions - good.length;
      const user = buildUserPrompt({ base, versions: need, figureType, misconceptionIds, fixNotes });
      let items: GeneratedItem[];
      try {
        const res = await this.ai.chat({
          systemPrompt: SYSTEM_PROMPT,
          prompt: user,
          preferredProvider: 'claude',
          timeoutMs: 60_000,
          maxTokens: 8000,
        });
        items = this.parseModelJson(res.text) as GeneratedItem[];
      } catch (err) {
        if (round === 0) throw err; // first-round failure bubbles to the batch handler
        break; // a later retry hiccup: keep what already passed
      }
      const nextNotes = new Set<string>();
      for (const it of items) {
        if (good.length >= versions) break;
        const fails = this.itemQualityFails(it);
        if (!fails.length) good.push(it);
        else fails.forEach((f) => nextNotes.add(f));
      }
      fixNotes = [...nextNotes].slice(0, 8);
      this.logger.log(
        `slate round ${round + 1}: ${good.length}/${versions} good` +
          (fixNotes.length ? `, fixing: ${fixNotes.join(' | ')}` : ''),
      );
    }
    return good.slice(0, versions);
  }

  /**
   * Deterministic, non-repairable quality gates that drive regeneration (the
   * repairable issues — e.g. an untagged distractor — are fixed later in persist,
   * so they don't trigger a re-prompt). Reuses the shared guards so the loop, the
   * write path, and the inventory sweep all agree on what "bad" means.
   */
  private itemQualityFails(it: GeneratedItem): string[] {
    const fails: string[] = [];
    const opts = it.options ?? [];
    if (opts.length !== 4 || opts.filter((o) => o.correct).length !== 1 || opts.some((o) => !o.text?.trim())) {
      fails.push('options: need exactly 4, one correct, none blank');
    }
    if (solutionLeaksReasoning(it.solution)) {
      fails.push('solution: rambling/self-correction — write a clean step-by-step worked solution');
    }
    const text = `${it.stem} ${opts.map((o) => o.text).join(' ')}`;
    if (it.figure && !figureIsSane(it.figure, text).ok) {
      fails.push('figure: numbers must match the item');
    }
    if (!it.figure && stemReferencesFigure(String(it.stem ?? ''))) {
      fails.push('figure: stem references a figure but none is provided');
    }
    if (stemNotSelfContained(it.stem)) {
      fails.push('stem: not self-contained — never refer to "again"/a previous item; make it stand alone');
    }
    return fails;
  }

  /**
   * Correctness self-check (LLM-as-judge). Independently re-solves each generated
   * item and keeps ONLY the ones the judge confirms are correct, unambiguous, and
   * well-formed (and, for error-analysis items, actually built on a real mistake).
   * Wrong/ambiguous items are dropped before they can be saved. Fails OPEN on a
   * verifier error (keeps items, which still pass the structural gate) so a
   * transient hiccup never wipes a batch.
   */
  private async verifyItems(items: GeneratedItem[]): Promise<{ kept: GeneratedItem[]; dropped: number }> {
    if (!Array.isArray(items) || !items.length) return { kept: [], dropped: 0 };
    // The LLM proposes; the single deterministic judge (item-judge.ts) has the
    // veto. Every item the AI keeps is re-solved and figure-checked here, so a
    // computably-wrong item is dropped even if the AI fails open on a timeout.
    const llm = await this.verifyItemsLlm(items);
    const kept = llm.kept.filter((it) =>
      judgeItem(
        { stem: it.stem, options: it.options, answer: it.answer == null ? undefined : String(it.answer), solution: it.solution, standard: it.standard, figure: it.figure ?? undefined },
        'practice',
      ).ok,
    );
    return { kept, dropped: items.length - kept.length };
  }

  private async verifyItemsLlm(items: GeneratedItem[]): Promise<{ kept: GeneratedItem[]; dropped: number }> {
    if (!Array.isArray(items) || !items.length) return { kept: [], dropped: 0 };
    const payload = items.map((it, i) => ({
      i,
      versionType: it.versionType,
      stem: it.stem,
      options: (it.options ?? []).map((o) => o.text),
      correctIndex: (it.options ?? []).findIndex((o) => o.correct),
      solution: it.solution ?? '',
      figure: it.figure ? JSON.stringify(it.figure).slice(0, 400) : null,
    }));
    const system =
      'You are a STRICT K-8 math item checker. For each item, independently solve the problem from ' +
      'scratch, then judge whether it is SAFE to publish to students. Mark ok=false if ANY of these ' +
      'hold: the option at correctIndex is NOT the truly correct answer; the item is ambiguous or has ' +
      'more than one defensible answer; required information is missing; or numbers or units are ' +
      'inconsistent. ' +
      'EXTRA RULE for "psychology"/error-analysis items (the stem shows a student who reached a WRONG ' +
      'answer and asks what mistake was made): (1) compute the TRUE correct answer; (2) read the ' +
      "student's stated wrong answer from the stem; (3) take the specific error named by the option at " +
      "correctIndex and APPLY it yourself — it MUST mechanically reproduce the student's exact stated " +
      'wrong answer. If it does not, ok=false. Concrete reject example: the correct slope is -2/3 and the ' +
      'student wrote -1/3, but the marked error "ran over rise / inverted the slope" actually yields ' +
      "-3/2 (not -1/3), so the named mistake does NOT produce the student's answer → ok=false. Also " +
      'reject any error-analysis item where the student was actually correct. ' +
      'SOLUTION + FIGURE: also mark ok=false if the "solution" rambles or contains self-correction ' +
      '("let me recalculate", "wait", "but the answer is") instead of a clean step-by-step worked solution, ' +
      'or its final result does not equal the option at correctIndex; OR if a "figure" is present but its ' +
      'numbers do not match the problem, or the stem refers to a figure that is missing. ' +
      'Only mark ok=true when you are confident the marked answer is correct, AND (for error-analysis) the ' +
      "named mistake reproduces the student's stated wrong answer, AND the item is unambiguous and " +
      'well-formed. Return JSON ONLY: an array of {"i": <index>, "ok": <true|false>, "reason": <short>}. ' +
      'Be strict — when in doubt, ok=false.';
    try {
      const res = await this.ai.chat({
        systemPrompt: system,
        prompt: JSON.stringify(payload),
        preferredProvider: 'claude',
        timeoutMs: 60_000,
        maxTokens: 4000,
      });
      const verdicts = this.parseModelJson(res.text) as Array<{ i?: number; ok?: boolean }>;
      if (!verdicts.length) return { kept: items, dropped: 0 }; // fail open on no verdicts
      const okIndexes = new Set(verdicts.filter((v) => v.ok === true).map((v) => Number(v.i)));
      const kept = items.filter((_, i) => okIndexes.has(i));
      // If the judge somehow approved nothing, fail open rather than lose everything.
      if (!kept.length) return { kept: items, dropped: 0 };
      return { kept, dropped: items.length - kept.length };
    } catch {
      return { kept: items, dropped: 0 }; // fail open on verifier error
    }
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
  ): Promise<{ saved: number; skipped: number; invalid: number }> {
    if (!Array.isArray(items) || !items.length) return { saved: 0, skipped: 0, invalid: 0 };
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    let invalid = 0;
    // Resolve the standard once so we can backfill ga / gaCluster when the model
    // (or a seed) leaves them blank — keeps targeted-practice routing intact.
    const resolved = resolveStandard(String(base.standard || ''));
    // Seeds are reference-only and must NEVER be persisted. Guard against a
    // generated version coming back as (or containing) the source question verbatim
    // so a copyrighted seed can't leak into the bank.
    const seedKey = this.normStem(String(base.stem || ''));
    for (const it of items) {
      const conv = it.figure ? { stem: it.stem, figure: null } : this.tableToFigure(it.stem);
      const key = this.normStem(conv.stem);
      if (!key || seen.has(key)) {
        skipped++;
        continue;
      }
      if (seedKey && (key === seedKey || key.includes(seedKey))) {
        skipped++; // near-verbatim copy of the seed — drop it
        continue;
      }
      seen.add(key);
      const options = this.normalizeOptions(it.options);
      // Hard structural gate: NEVER save an item that isn't exactly 4 options with
      // one correct and no blank text. These reach students as drafts otherwise.
      if (options.length !== 4 || options.filter((o) => o.correct).length !== 1 || options.some((o) => !o.text.trim())) {
        invalid++;
        continue;
      }
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
      const stemText = String(conv.stem ?? '');
      const solutionText = String(it.solution ?? '');
      let figure = this.sanitizeFigure(stemText, (it.figure as object) ?? conv.figure ?? undefined);
      // Never persist an unrenderable figure: a mis-shaped spec (wrong field names /
      // unknown type) would silently show as a blank box. Strip it here so the item
      // is kept as the self-contained text item it is (and dropped just below only if
      // the stem actually references a figure). One canonical contract, shared.
      if (figure && !isRenderableFigure(figure)) figure = undefined;
      // Correct-by-rejection at the source: never persist a leaked-reasoning
      // ("Shakespeare") solution, a figure whose numbers don't match the problem,
      // or a stem that references a figure it doesn't have. Shared guards, same
      // ones the tutor and inventory sweep use.
      if (solutionLeaksReasoning(solutionText)) { invalid++; continue; }
      if (figure && !figureIsSane(figure, `${stemText} ${options.map((o) => o.text).join(' ')}`).ok) { invalid++; continue; }
      if (!figure && stemReferencesFigure(stemText)) { invalid++; continue; }
      rows.push({
        batchId,
        baseSourceId: base.sourceId ?? base.stem.slice(0, 40),
        status: 'draft',
        versionType: String(it.versionType ?? 'item'),
        stem: stemText,
        figure,
        options: options as unknown as object,
        answer,
        solution: solutionText,
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
    return { saved: rows.length, skipped, invalid };
  }

  /**
   * Firewalled dual-write: stage a completed batch's serveable practice drafts
   * into the DIAGNOSTIC bank as `draft` rows (source 'generated'). They enter the
   * review pipeline (validate -> publish) and NEVER score a placement until a
   * human publishes them AND they are calibrated. This is how one authoring run
   * feeds both banks while preserving the measurement firewall.
   */
  async stageBatchToDiagnostic(
    batchId: string,
  ): Promise<{ staged: number; skipped: number }> {
    const drafts = await this.prisma.draftItem.findMany({
      where: { batchId, status: { not: 'rejected' } },
    });
    if (!drafts.length) return { staged: 0, skipped: 0 };
    const existing = await this.prisma.diagnosticItem.findMany({
      select: { stem: true },
    });
    const seen = new Set(existing.map((e) => this.normStem(e.stem)));
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;
    for (const d of drafts) {
      const key = this.normStem(d.stem);
      if (!key || seen.has(key)) {
        skipped++;
        continue;
      }
      const opts = Array.isArray(d.options)
        ? (d.options as unknown as { text?: string; correct?: boolean }[])
        : [];
      const correct = opts.findIndex((o) => o?.correct);
      // Only stage structurally sound items; the firewall keeps them non-scoring
      // until human-published, but there's no reason to stage broken ones.
      if (opts.length !== 4 || correct < 0) {
        skipped++;
        continue;
      }
      seen.add(key);
      const std = String(d.ga || d.standard || '');
      rows.push({
        grade: this.gradeFromStandard(std) ?? 6,
        strand: this.strandFromStandard(std),
        kc: d.skillNode || d.standard || '',
        standard: std,
        dok: typeof d.dok === 'number' ? d.dok : null,
        b: 0,
        stem: d.stem,
        options: opts.map((o) => String(o?.text ?? '')),
        correct,
        status: 'draft',
        source: 'generated',
        createdBy: d.createdBy ?? null,
      });
    }
    if (rows.length)
      await this.prisma.diagnosticItem.createMany({ data: rows as never });
    return { staged: rows.length, skipped };
  }

  private gradeFromStandard(s: string): number | null {
    const m = s.match(/(?:MGSE)?(\d+)\s*\./i) || s.match(/(\d+)/);
    const g = m ? Number(m[1]) : NaN;
    return Number.isFinite(g) && g >= 0 && g <= 12 ? g : null;
  }

  private strandFromStandard(s: string): string {
    const m = s.toUpperCase().match(/(?:MGSE)?\d+\.?([A-Z]{1,3})/);
    return m ? m[1] : '';
  }

  /**
   * Auto-reject serveable practice items that fail the SAME reliability gate new
   * items must pass: structural (exactly 4 options, exactly one correct, none
   * blank), leaked-reasoning ("shakespeare") solutions, unsound or
   * missing-but-referenced figures, and non-self-contained stems. Reuses the
   * shared guards so the generator, the write path, the regenerate loop, and this
   * sweep all agree on what "bad" means. Self-heals the bank — including drafts
   * created BEFORE those guards existed — so they stop reaching students. Runs at
   * the end of every generation and on-demand via the admin "purge" endpoint.
   */
  async purgeInvalidDrafts(
    dryRun = false,
  ): Promise<{
    dryRun: boolean;
    count: number;
    reasons: Record<string, number>;
    items: Array<{ id: string; reason: string; standard: string | null; stem: string }>;
  }> {
    const drafts = await this.prisma.draftItem.findMany({
      where: { status: { in: ['draft', 'validated', 'field_test'] } },
      select: { id: true, stem: true, options: true, solution: true, figure: true, standard: true },
    });
    const reasons: Record<string, number> = {};
    const items: Array<{ id: string; reason: string; standard: string | null; stem: string }> = [];
    const badIds: string[] = [];
    for (const d of drafts) {
      const reason = this.draftGateFailure(d);
      if (reason) {
        badIds.push(d.id);
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        items.push({
          id: d.id,
          reason,
          standard: (d.standard as string | null) ?? null,
          stem: String(d.stem ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
        });
      }
    }
    if (!dryRun && badIds.length) {
      await this.prisma.draftItem.updateMany({ where: { id: { in: badIds } }, data: { status: 'rejected' } });
    }
    this.logger.log(
      `purge${dryRun ? ' (dry-run)' : ''}: ${dryRun ? 'would reject' : 'rejected'} ${badIds.length}/${drafts.length} drafts` +
        (badIds.length ? ` (${Object.entries(reasons).map(([k, v]) => `${k}:${v}`).join(', ')})` : ''),
    );
    return { dryRun, count: badIds.length, reasons, items };
  }

  /**
   * The first failing gate reason for a PERSISTED draft row, or null if it is
   * clean. Mirrors `itemQualityFails` but reads the stored shape (options/figure
   * as JSON). Kept in lock-step with that function so a live-generated item and a
   * stored item are judged identically.
   */
  private draftGateFailure(d: {
    stem: unknown;
    options: unknown;
    solution: unknown;
    figure: unknown;
  }): string | null {
    let opts: Array<{ correct?: boolean; text?: string }> = [];
    const raw = d.options as unknown;
    if (Array.isArray(raw)) opts = raw as typeof opts;
    else if (typeof raw === 'string') { try { opts = JSON.parse(raw); } catch { opts = []; } }
    const correct = opts.filter((o) => o?.correct === true).length;
    if (opts.length !== 4 || correct !== 1 || opts.some((o) => !String(o?.text ?? '').trim())) return 'options';
    const stem = String(d.stem ?? '');
    const solution = d.solution == null ? '' : String(d.solution);
    if (solutionLeaksReasoning(solution)) return 'solution_leaked';
    const text = `${stem} ${opts.map((o) => o?.text ?? '').join(' ')}`;
    if (d.figure && !figureIsSane(d.figure, text).ok) return 'figure_unsound';
    if (!d.figure && stemReferencesFigure(stem)) return 'figure_missing_referenced';
    if (stemNotSelfContained(stem)) return 'stem_not_self_contained';
    return null;
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

  /**
   * Deterministic figure↔stem consistency guard (mirror of the diagnostic bank's).
   * A flat triangle/rect can never stand in for a cone/cylinder/sphere/volume item,
   * and a (right) triangle only belongs on a real triangle/Pythagorean item — drop
   * a mismatched figure so a wrong picture never reaches even a draft.
   */
  private sanitizeFigure(stem: string, figure: object | undefined): object | undefined {
    if (!figure || typeof figure !== 'object') return undefined;
    const t = String((figure as { type?: unknown }).type ?? '');
    const s = stem.toLowerCase();
    const isSolidOrVolume = /\b(volume|surface area|cone|cylinder|sphere|prism|pyramid|cubic)\b/.test(s);
    if (isSolidOrVolume && ['right_triangle', 'triangle', 'rect', 'angle'].includes(t)) return undefined;
    if (t === 'right_triangle' || t === 'triangle') {
      const looksTriangle =
        /triangle|hypotenuse|\bleg(s)?\b|right angle|pythag|ladder|\bramp\b|\brope\b|\bwire\b|diagonal|slant|how (far|high)|distance (between|from|to)|shortest/.test(s);
      if (!looksTriangle) return undefined;
    }
    if (t === 'cylinder' && !/cylind/.test(s)) return undefined;
    if (t === 'cone' && !/(\bcone|conical)/.test(s)) return undefined;
    if (t === 'sphere' && !/(spher|\bball\b|\bglobe\b)/.test(s)) return undefined;
    if (t === 'circle' && !/(circle|circular|radius|diameter|circumference|\bpi\b)/.test(s)) return undefined;
    return figure;
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

  async queue(q: { status?: string; batchId?: string; page?: number; pageSize?: number; search?: string; grade?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(Number(q.pageSize) || 25, 1000);
    const where: Record<string, unknown> = {
      status: (q.status as never) || undefined,
      batchId: q.batchId || undefined,
      stem: q.search ? { contains: String(q.search), mode: 'insensitive' as const } : undefined,
    };
    // Grade filter: match on the standard/GA code prefix (grade 8 = MGSE8.* or 8.*),
    // so you can slice the whole bank by grade regardless of which batch made an item.
    const g = q.grade ? String(q.grade).trim() : '';
    if (g) {
      where.OR = [
        { standard: { startsWith: `MGSE${g}` } },
        { standard: { startsWith: `${g}.` } },
        { ga: { startsWith: `${g}.` } },
      ];
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.draftItem.findMany({
        where: where as never,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.draftItem.count({ where: where as never }),
    ]);
    return { items, total, page, pageSize };
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
        figure: true,
      },
    })) as unknown as BankRow[];
    // Diagnostic bank = the LIVE DiagnosticItem table (what the scored adaptive
    // diagnostic actually serves via publishedBank), NOT the in-code seed. This
    // is the same source the Diagnostic Bank page reads, so the two views agree.
    const diagnostic = (await this.prisma.diagnosticItem.findMany({
      select: {
        id: true, grade: true, strand: true, kc: true, standard: true, dok: true,
        b: true, stem: true, options: true, correct: true, status: true, figure: true,
      },
    })) as unknown as DiagnosticRow[];
    return buildIntegrityReport(rows, diagnostic);
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
