/**
 * EdKairos · item-generation · database integrity report (PURE LOGIC)
 * ---------------------------------------------------------------------------
 * Whole-inventory integrity sweep for the Super-Admin "Verify Database" gate
 * run before opening sales. No NestJS — importable + unit-testable.
 *
 * EdKairos questions live in TWO separate banks, by design:
 *
 *   1. Generated practice bank — the DraftItem table (Postgres). AI-authored,
 *      unscored, served to students via practice. Lifecycle: draft -> validated
 *      -> field_test -> operational (+ rejected). Uncalibrated.
 *
 *   2. Calibrated diagnostic bank — the DiagnosticItem table (Postgres), the
 *      scored "ruler" the adaptive diagnostic serves (published items). Built via
 *      the Diagnostic Bank Build/Review/Publish flow; "calibrated" = validated +
 *      published. The in-code DIAGNOSTIC_ITEM_BANK is only a client fallback.
 *
 * Each bank gets its own coverage (grade / standard|strand), structural checks,
 * duplicate detection, and a go / no-go verdict. A combined total sits on top.
 * The two are reported side by side but never merged — they have different
 * shapes and different integrity rules.
 */
import { CROSSWALK } from './mgse-ga-crosswalk';
import { figureIsSane, solutionLeaksReasoning, stemNotSelfContained } from './reliability-gate';
import { judgeItem, type JudgeResult } from './item-judge';

/* ---------- honest verification (Phase 0, 1 Nov 2026) ----------------------
   Before this, an item whose answer the re-solver could not read ('unsupported')
   counted as clean, figure mismatches were warnings that could not turn the page
   red, and the page never said how much it had actually checked. Every
   serveable item is now one of:
     verified  - answer independently re-solved AND no figure problem found;
     failed    - any blocker, or a figure the checks find unsound/unrenderable;
     unchecked - nothing wrong found, but the answer was NOT independently
                 re-solved, so the page cannot vouch for it.
   "Ready" now also requires the unchecked share to be at or under a limit
   (INTEGRITY_MAX_UNCHECKED_PCT, default 5).
   NOT YET CHECKED by any rule: figure VALUES against the question (labels vs
   numbers, lines vs equations, table rates, bar values). That is Phase 1; see
   src/quality/golden for the recorded gaps. */
export type VerificationStatus = 'verified' | 'failed' | 'unchecked';

const FIGURE_FAIL_WARNINGS = new Set(['figure_unsound', 'figure_unrenderable']);

export function verificationOf(j: JudgeResult): VerificationStatus {
  if (j.blockers.length > 0 || j.warnings.some((w) => FIGURE_FAIL_WARNINGS.has(w.id))) return 'failed';
  return j.answerCheck === 'confirmed' ? 'verified' : 'unchecked';
}

export interface VerificationSummary {
  total: number;
  verified: number;
  failed: number;
  unchecked: number;
  verifiedPct: number;
  uncheckedPct: number;
  maxUncheckedPct: number;
}

export const DEFAULT_MAX_UNCHECKED_PCT = 5;

function summarise(statuses: VerificationStatus[], maxUncheckedPct: number): VerificationSummary {
  const total = statuses.length;
  const count = (s: VerificationStatus) => statuses.filter((x) => x === s).length;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const verified = count('verified');
  const unchecked = count('unchecked');
  return { total, verified, failed: count('failed'), unchecked, verifiedPct: pct(verified), uncheckedPct: pct(unchecked), maxUncheckedPct };
}

function verificationLine(v: VerificationSummary): string {
  return `Verified ${v.verifiedPct}% (${v.verified} of ${v.total}) · ${v.failed} failed · ${v.unchecked} not independently checked (${v.uncheckedPct}%).`;
}

/** Defect groups every bank gets from the verification pass. */
function verificationDefects(v: VerificationSummary, uncheckedIds: string[], noun: string): DefectGroup[] {
  const out: DefectGroup[] = [];
  if (v.unchecked > 0) {
    const over = v.uncheckedPct > v.maxUncheckedPct;
    out.push(group(
      'answer_not_checked',
      over ? 'blocker' : 'warning',
      `${v.unchecked} of ${v.total} ${noun} (${v.uncheckedPct}%) were never independently checked: the re-solver could not read their wording or type, so this page cannot vouch for their answers. Limit for "ready": ${v.maxUncheckedPct}%.`,
      uncheckedIds,
    ));
  }
  out.push({
    id: 'figure_values_not_compared',
    severity: 'info',
    message: 'Not checked yet by any rule: figure values against the question (labels vs drawn numbers, lines vs stated equations, table rates, bar values). Recorded as gaps in the golden error suite.',
    count: 0,
    sampleIds: [],
  });
  return out;
}

export const ALL_STATUSES = ['draft', 'validated', 'field_test', 'operational', 'rejected'] as const;
export const SERVEABLE_STATUSES = ['draft', 'validated', 'field_test', 'operational'] as const;
const SERVEABLE = new Set<string>(SERVEABLE_STATUSES);

/** Tolerant shape of a DraftItem row (options is Json on the model). */
export interface BankRow {
  id: string;
  status: string;
  standard?: string | null;
  ga?: string | null;
  gaCluster?: string | null;
  skillTags?: string[] | null;
  misconceptionTags?: string[] | null;
  options?: unknown;
  stem?: string | null;
  answer?: string | null;
  solution?: string | null;
  dok?: number | null;
  difficulty?: string | null;
  figure?: unknown;
}

/** Tolerant shape of a DiagnosticItem row (the live scored bank in Postgres). */
export interface DiagnosticRow {
  id: string;
  grade?: number | null;
  strand?: string | null;
  kc?: string | null;
  standard?: string | null;
  dok?: number | null;
  b?: number | null;
  stem?: string | null;
  options?: unknown;
  correct?: number | null;
  status?: string | null;
  figure?: unknown;
}

export type Severity = 'blocker' | 'warning' | 'info';

export interface DefectGroup {
  id: string;
  severity: Severity;
  message: string;
  count: number;
  sampleIds: string[];
}

export interface CoverageRow {
  key: string;
  label?: string;
  grade: number | null;
  total: number;
  serveable: number;
  /** lifecycle breakdown — present for the generated bank, null for the scored bank */
  byStatus: Record<string, number> | null;
}

export interface GradeRow {
  grade: number | null;
  total: number;
  serveable: number;
}

export interface BankSection {
  key: 'generated' | 'diagnostic';
  label: string;
  scored: boolean;
  note: string;
  /** column key for the coverage table's first column */
  coverageLabel: string;
  /** whether coverage rows carry lifecycle status columns */
  hasStatus: boolean;
  total: number;
  serveable: number;
  byStatus: Record<string, number> | null;
  byGrade: GradeRow[];
  coverage: CoverageRow[];
  tags: { skill: { tag: string; count: number }[]; misconception: { tag: string; count: number }[] } | null;
  defects: DefectGroup[];
  verification: VerificationSummary;
  verdict: { ready: boolean; blockers: number; warnings: number; summary: string };
}

export interface IntegrityReport {
  generatedAt: string;
  combined: {
    totalQuestions: number;
    banks: { key: string; label: string; total: number; serveable: number }[];
    verification: VerificationSummary;
    ready: boolean;
    summary: string;
  };
  banks: BankSection[];
}

// ---- helpers ---------------------------------------------------------------

function normStem(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function gradeFromCode(src: string): number | null {
  const m = src.match(/(?:MGSE)?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function group(id: string, severity: Severity, message: string, ids: string[]): DefectGroup {
  return { id, severity, message, count: ids.length, sampleIds: ids.slice(0, 10) };
}

function tally(rows: BankRow[], pick: (r: BankRow) => string[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) for (const t of pick(r)) {
    const key = String(t).trim();
    if (key) m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

function sortGrades(rows: GradeRow[]): GradeRow[] {
  return rows.sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99));
}

interface ParsedOption { text: string; correct: boolean; tag: string }
function parseOptions(raw: unknown): ParsedOption[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr.map((o) => {
    const opt = (o ?? {}) as { text?: unknown; correct?: unknown; misconceptionTag?: unknown };
    return {
      text: String(opt.text ?? ''),
      correct: opt.correct === true,
      tag: String(opt.misconceptionTag ?? ''),
    };
  });
}

const TITLE_BY_GA = new Map(CROSSWALK.map((e) => [e.ga.toUpperCase(), e.title]));

// ---- generated practice bank (DraftItem) -----------------------------------

function buildGeneratedSection(rows: BankRow[], maxUncheckedPct: number): BankSection {
  const serveable = rows.filter((r) => SERVEABLE.has(r.status));

  const byStatus: Record<string, number> = {};
  for (const s of ALL_STATUSES) byStatus[s] = 0;
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  // coverage by GA cluster
  const covMap = new Map<string, CoverageRow & { gaCodes: string[] }>();
  for (const r of rows) {
    const key = String(r.gaCluster || r.ga || r.standard || 'UNKNOWN').trim() || 'UNKNOWN';
    let e = covMap.get(key);
    if (!e) {
      e = {
        key, grade: gradeFromCode(String(r.gaCluster || r.ga || r.standard || '')),
        total: 0, serveable: 0,
        byStatus: Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<string, number>,
        gaCodes: [],
      };
      covMap.set(key, e);
    }
    e.total += 1;
    if (SERVEABLE.has(r.status)) e.serveable += 1;
    if (e.byStatus) e.byStatus[r.status] = (e.byStatus[r.status] ?? 0) + 1;
    const ga = String(r.ga ?? '').trim();
    if (ga && !e.gaCodes.includes(ga)) {
      e.gaCodes.push(ga);
      if (!e.label) e.label = TITLE_BY_GA.get(ga.toUpperCase());
    }
  }
  const coverage: CoverageRow[] = [...covMap.values()]
    .map(({ gaCodes: _g, ...c }) => c)
    .sort((a, b) => a.key.localeCompare(b.key));

  // by grade
  const gradeMap = new Map<number | null, GradeRow>();
  for (const r of rows) {
    const g = gradeFromCode(String(r.gaCluster || r.ga || r.standard || ''));
    const e = gradeMap.get(g) ?? { grade: g, total: 0, serveable: 0 };
    e.total += 1;
    if (SERVEABLE.has(r.status)) e.serveable += 1;
    gradeMap.set(g, e);
  }

  // defects (serveable only — those reach students)
  const badCorrect: string[] = [], badCount: string[] = [], emptyText: string[] = [];
  const noStem: string[] = [], noAnswer: string[] = [], noSolution: string[] = [];
  const untagged: string[] = [], notMgse: string[] = [], noCluster: string[] = [];
  const badFigure: string[] = [], missingFig: string[] = [], leakedSolution: string[] = [], notSelfContained: string[] = [];
  const misKeyed: string[] = [], noCorrectOpt: string[] = [], figIncomplete: string[] = [];
  const unrenderable: string[] = [], uncheckedIds: string[] = [];
  const statuses: VerificationStatus[] = [];
  const stemBuckets = new Map<string, string[]>();

  for (const r of serveable) {
    const opts = parseOptions(r.options);
    // Single judge (item-judge.ts) — the SAME verdict the write paths use, so the
    // report can never disagree with what actually gets blocked. We read its
    // correctness + figure blockers here; the structural counts below stay as the
    // report's own coverage tallies.
    // `solution` is passed so the judge sees the whole item (it was omitted, which
    // made the judge report "no worked solution" on every practice item).
    const j = judgeItem({ stem: r.stem, options: r.options, answer: r.answer, solution: r.solution, figure: r.figure, standard: r.standard }, 'practice');
    const jb = new Set(j.blockers.map((b) => b.id));
    const status = verificationOf(j);
    statuses.push(status);
    if (status === 'unchecked') uncheckedIds.push(r.id);
    if (j.warnings.some((w) => w.id === 'figure_unrenderable')) unrenderable.push(r.id);
    if (jb.has('mis_keyed')) misKeyed.push(r.id);
    if (jb.has('no_correct_option')) noCorrectOpt.push(r.id);
    if (jb.has('figure_incomplete')) figIncomplete.push(r.id);
    if (jb.has('figure_missing') || jb.has('figure_missing_referenced')) missingFig.push(r.id);
    if (r.figure) {
      const sane = figureIsSane(r.figure, `${r.stem ?? ''} ${opts.map((o) => o.text).join(' ')}`);
      if (!sane.ok) badFigure.push(r.id);
    }
    if (solutionLeaksReasoning(r.solution)) leakedSolution.push(r.id);
    if (stemNotSelfContained(r.stem)) notSelfContained.push(r.id);
    if (opts.filter((o) => o.correct).length !== 1) badCorrect.push(r.id);
    if (opts.length !== 4) badCount.push(r.id);
    if (opts.some((o) => !o.text.trim())) emptyText.push(r.id);
    if (opts.some((o) => !o.correct && !o.tag.trim())) untagged.push(r.id);
    if (!String(r.stem ?? '').trim()) noStem.push(r.id);
    if (!String(r.answer ?? '').trim()) noAnswer.push(r.id);
    if (!String(r.solution ?? '').trim()) noSolution.push(r.id);
    if (!/^MGSE/i.test(String(r.standard ?? '').trim())) notMgse.push(r.id);
    if (!String(r.gaCluster ?? '').trim()) noCluster.push(r.id);
    const key = normStem(r.stem);
    if (key) { const b = stemBuckets.get(key) ?? []; b.push(r.id); stemBuckets.set(key, b); }
  }
  const dupIds: string[] = []; let dupGroups = 0;
  for (const ids of stemBuckets.values()) if (ids.length > 1) { dupGroups += 1; dupIds.push(...ids.slice(1)); }

  const defects: DefectGroup[] = [];
  if (misKeyed.length) defects.push(group('mis_keyed', 'blocker', 'Serveable items whose keyed answer is NOT the independently computed correct answer (re-solved)', misKeyed));
  if (noCorrectOpt.length) defects.push(group('no_correct_option', 'blocker', 'Serveable items where the computed answer matches none of the options', noCorrectOpt));
  if (figIncomplete.length) defects.push(group('figure_incomplete', 'blocker', 'Serveable items whose figure is present but does not match the shape the stem describes (e.g. one circle drawn for two, a flat shape for a 3-D solid)', figIncomplete));
  if (badCorrect.length) defects.push(group('one_correct_option', 'blocker', 'Items without exactly one correct option', badCorrect));
  if (badCount.length) defects.push(group('four_options', 'blocker', 'Items that do not have exactly four options', badCount));
  if (emptyText.length) defects.push(group('option_text', 'blocker', 'Items with a blank option', emptyText));
  if (noStem.length) defects.push(group('has_stem', 'blocker', 'Items with no question stem', noStem));
  if (noAnswer.length) defects.push(group('has_answer', 'blocker', 'Items with no answer', noAnswer));
  if (noSolution.length) defects.push(group('has_solution', 'blocker', 'Items with no worked solution', noSolution));
  if (untagged.length) defects.push(group('distractors_tagged', 'warning', 'Items with an untagged distractor (no misconception tag)', untagged));
  if (notMgse.length) defects.push(group('standard_not_mgse', 'warning', 'Serveable items whose standard is not MGSE-format — targeted practice cannot route these', notMgse));
  if (noCluster.length) defects.push(group('missing_ga_cluster', 'warning', 'Serveable items missing a GA cluster', noCluster));
  if (dupIds.length) defects.push(group('duplicate_stems', 'warning', `Duplicate stems across ${dupGroups} group(s) — extra copies beyond the first`, dupIds));
  // Phase 0: a figure that does not match its question is a BLOCKER on this page
  // (it was a warning, so it could never make the page say "not ready").
  if (badFigure.length) defects.push(group('figure_unsound', 'blocker', 'Serveable items with a malformed or mismatched figure (bad coordinates, or numbers absent from the item text)', badFigure));
  if (unrenderable.length) defects.push(group('figure_unrenderable', 'blocker', 'Serveable items whose figure matches no renderer — students see a blank box', unrenderable));
  if (missingFig.length) defects.push(group('figure_missing_referenced', 'blocker', 'Serveable items whose stem references a figure that is not attached', missingFig));
  if (leakedSolution.length) defects.push(group('solution_leaked', 'warning', 'Serveable items whose worked solution rambles or leaks reasoning (not a clean solution)', leakedSolution));
  if (notSelfContained.length) defects.push(group('stem_not_self_contained', 'warning', 'Serveable items whose stem refers to earlier context the student cannot see (e.g. "look at the spinner again")', notSelfContained));

  const verification = summarise(statuses, maxUncheckedPct);
  defects.push(...verificationDefects(verification, uncheckedIds, 'serveable practice items'));

  const blockers = defects.filter((d) => d.severity === 'blocker').length;
  const warnings = defects.filter((d) => d.severity === 'warning').length;
  const ready = blockers === 0;
  const summary = `${verificationLine(verification)} ` + (ready
    ? warnings === 0
      ? `No defects found in ${serveable.length} serveable item(s).`
      : `No blocking defects. ${warnings} warning type(s) to review.`
    : `${blockers} blocking defect type(s) reach students via practice — Reject them in the generator before sales.`);

  return {
    key: 'generated',
    label: 'Generated practice bank',
    scored: false,
    note: 'AI-authored items in the DraftItem table, served to students via practice (unscored). Rejected items are excluded from serveable counts.',
    coverageLabel: 'Standard',
    hasStatus: true,
    total: rows.length,
    serveable: serveable.length,
    byStatus,
    byGrade: sortGrades([...gradeMap.values()]),
    coverage,
    tags: {
      skill: tally(serveable, (r) => r.skillTags ?? []),
      misconception: tally(serveable, (r) => r.misconceptionTags ?? []),
    },
    defects,
    verification,
    verdict: { ready, blockers, warnings, summary },
  };
}

// ---- calibrated diagnostic bank (DiagnosticItem table, the live scored bank) --

// The scored adaptive diagnostic serves PUBLISHED items. "Calibrated" (serveable)
// counts validated + published — the review-approved set — matching the
// Diagnostic Bank page's viability bars. Draft/rejected are excluded.
const DIAG_SERVEABLE = new Set<string>(['validated', 'published']);
const DIAG_STATUSES = ['draft', 'validated', 'published', 'rejected'] as const;

function buildDiagnosticSection(items: DiagnosticRow[], maxUncheckedPct: number): BankSection {
  const isServe = (it: DiagnosticRow) => DIAG_SERVEABLE.has(String(it.status ?? ''));
  const serveableItems = items.filter(isServe);

  const byStatus: Record<string, number> = {};
  for (const s of DIAG_STATUSES) byStatus[s] = 0;
  for (const it of items) {
    const s = String(it.status ?? 'draft');
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  // coverage by strand + by grade (serveable = validated + published)
  const covMap = new Map<string, CoverageRow>();
  const gradeMap = new Map<number | null, GradeRow>();
  for (const it of items) {
    const serve = isServe(it);
    const strand = String(it.strand ?? 'UNKNOWN').trim() || 'UNKNOWN';
    let c = covMap.get(strand);
    if (!c) { c = { key: strand, grade: null, total: 0, serveable: 0, byStatus: null }; covMap.set(strand, c); }
    c.total += 1; if (serve) c.serveable += 1;

    const g = typeof it.grade === 'number' ? it.grade : null;
    const gr = gradeMap.get(g) ?? { grade: g, total: 0, serveable: 0 };
    gr.total += 1; if (serve) gr.serveable += 1; gradeMap.set(g, gr);
  }
  const coverage = [...covMap.values()].sort((a, b) => a.key.localeCompare(b.key));

  // structural + field checks (serveable only — those calibrate the diagnostic)
  const noStem: string[] = [], badCorrect: string[] = [], fewOptions: string[] = [], emptyText: string[] = [];
  const noStrand: string[] = [], noKc: string[] = [], noB: string[] = [], noDok: string[] = [], noStandard: string[] = [], dupId: string[] = [];
  const misKeyed: string[] = [], noCorrectOpt: string[] = [], figIncomplete: string[] = [], figMissing: string[] = [];
  const figUnsound: string[] = [], figUnrenderable: string[] = [], figInvalid: string[] = [], uncheckedIds: string[] = [];
  const statuses: VerificationStatus[] = [];
  const stemBuckets = new Map<string, string[]>();
  const idsSeen = new Set<string>();

  for (const it of serveableItems) {
    const opts = Array.isArray(it.options) ? it.options.map((o) => String(o ?? '')) : [];
    // Single judge on the SCORED bank (the moat) — identical verdict to the
    // scored write path (factCheck -> item-judge), so the report matches reality.
    const j = judgeItem({ stem: it.stem, options: it.options, correct: it.correct, figure: it.figure, standard: it.standard }, 'scored');
    const jb = new Set(j.blockers.map((b) => b.id));
    const status = verificationOf(j);
    statuses.push(status);
    if (status === 'unchecked') uncheckedIds.push(it.id);
    // Phase 0: these were judged but never reported for the scored bank.
    if (jb.has('figure_invalid')) figInvalid.push(it.id);
    if (j.warnings.some((w) => w.id === 'figure_unsound')) figUnsound.push(it.id);
    if (j.warnings.some((w) => w.id === 'figure_unrenderable')) figUnrenderable.push(it.id);
    if (jb.has('mis_keyed')) misKeyed.push(it.id);
    if (jb.has('no_correct_option')) noCorrectOpt.push(it.id);
    if (jb.has('figure_incomplete')) figIncomplete.push(it.id);
    if (jb.has('figure_missing') || jb.has('figure_missing_referenced')) figMissing.push(it.id);
    if (!String(it.stem ?? '').trim()) noStem.push(it.id);
    if (opts.length < 2) fewOptions.push(it.id);
    if (opts.some((o) => !o.trim())) emptyText.push(it.id);
    const ci = typeof it.correct === 'number' ? it.correct : -1;
    if (ci < 0 || ci >= opts.length) badCorrect.push(it.id);
    if (!String(it.strand ?? '').trim()) noStrand.push(it.id);
    if (!String(it.kc ?? '').trim()) noKc.push(it.id);
    if (typeof it.b !== 'number') noB.push(it.id);
    if (typeof it.dok !== 'number') noDok.push(it.id);
    if (!String(it.standard ?? '').trim()) noStandard.push(it.id);
    if (idsSeen.has(it.id)) dupId.push(it.id); else idsSeen.add(it.id);
    const key = normStem(it.stem);
    if (key) { const b = stemBuckets.get(key) ?? []; b.push(it.id); stemBuckets.set(key, b); }
  }
  const dupStems: string[] = []; let dupGroups = 0;
  for (const ids of stemBuckets.values()) if (ids.length > 1) { dupGroups += 1; dupStems.push(...ids.slice(1)); }

  const defects: DefectGroup[] = [];
  if (misKeyed.length) defects.push(group('mis_keyed', 'blocker', 'Calibrated items whose keyed answer is NOT the independently computed correct answer (re-solved)', misKeyed));
  if (noCorrectOpt.length) defects.push(group('no_correct_option', 'blocker', 'Calibrated items where the computed answer matches none of the options', noCorrectOpt));
  if (figIncomplete.length) defects.push(group('figure_incomplete', 'blocker', 'Calibrated items whose figure does not match the shape the stem describes (e.g. one circle for two, a flat shape for a 3-D solid)', figIncomplete));
  if (figMissing.length) defects.push(group('figure_missing_referenced', 'blocker', 'Calibrated items whose stem describes a figure that is not attached', figMissing));
  if (figInvalid.length) defects.push(group('figure_invalid', 'blocker', 'Calibrated items whose figure gives away the answer, uses off-grade coordinates, or names points that are not plotted', figInvalid));
  if (figUnsound.length) defects.push(group('figure_unsound', 'blocker', 'Calibrated items with a malformed or mismatched figure (bad coordinates, or numbers absent from the item text)', figUnsound));
  if (figUnrenderable.length) defects.push(group('figure_unrenderable', 'blocker', 'Calibrated items whose figure matches no renderer — students see a blank box', figUnrenderable));
  if (noStem.length) defects.push(group('has_stem', 'blocker', 'Items with no question stem', noStem));
  if (fewOptions.length) defects.push(group('min_options', 'blocker', 'Items with fewer than two options', fewOptions));
  if (badCorrect.length) defects.push(group('correct_index', 'blocker', 'Items whose correct index is out of range', badCorrect));
  if (emptyText.length) defects.push(group('option_text', 'blocker', 'Items with a blank option', emptyText));
  if (dupId.length) defects.push(group('duplicate_id', 'blocker', 'Items sharing an id (ids must be unique)', dupId));
  if (noStrand.length) defects.push(group('has_strand', 'warning', 'Items with no strand', noStrand));
  if (noKc.length) defects.push(group('has_kc', 'warning', 'Items with no knowledge component', noKc));
  if (noB.length) defects.push(group('has_difficulty', 'warning', 'Items with no calibrated difficulty (b) — adaptivity degrades', noB));
  if (noDok.length) defects.push(group('has_dok', 'warning', 'Calibrated items missing a DOK level — cannot verify the DOK 1–4 spread', noDok));
  if (noStandard.length) defects.push(group('has_standard', 'warning', 'Calibrated items missing a standard — cannot verify per-standard alignment', noStandard));
  if (dupStems.length) defects.push(group('duplicate_stems', 'warning', `Duplicate stems across ${dupGroups} group(s)`, dupStems));

  // Statistical-viability bar: each grade should reach a minimum number of
  // calibrated (validated + published) items — same count the Diagnostic Bank
  // page shows. Warnings (visible, not sales-blocking) make the growth gap clear.
  const VIABILITY_MIN = 100;
  for (const g of sortGrades([...gradeMap.values()])) {
    if (g.grade !== null && g.serveable < VIABILITY_MIN) {
      defects.push({
        id: `viability_grade_${g.grade}`,
        severity: 'warning',
        message: `Grade ${g.grade}: ${g.serveable}/${VIABILITY_MIN} calibrated items — ${VIABILITY_MIN - g.serveable} short of the statistical-viability minimum`,
        count: VIABILITY_MIN - g.serveable,
        sampleIds: [],
      });
    }
  }
  // DOK 1–4 spread across the calibrated set — now a real, gradable check.
  const dok = [1, 2, 3, 4].map((lvl) => serveableItems.filter((it) => it.dok === lvl).length);
  defects.push({
    id: 'dok_spread',
    severity: 'info',
    message: `DOK spread (calibrated): DOK1 ${dok[0]}, DOK2 ${dok[1]}, DOK3 ${dok[2]}, DOK4 ${dok[3]}`,
    count: serveableItems.length,
    sampleIds: [],
  });

  const verification = summarise(statuses, maxUncheckedPct);
  defects.push(...verificationDefects(verification, uncheckedIds, 'calibrated items'));

  const blockers = defects.filter((d) => d.severity === 'blocker').length;
  const warnings = defects.filter((d) => d.severity === 'warning').length;
  const ready = blockers === 0;
  const summary = `${verificationLine(verification)} ` + (ready
    ? warnings === 0
      ? `No defects found in ${serveableItems.length} calibrated item(s).`
      : `No blocking defects. ${warnings} warning type(s) to review.`
    : `${blockers} blocking defect type(s) in the scored bank — reject or fix them in the Diagnostic Bank before sales.`);

  return {
    key: 'diagnostic',
    label: 'Calibrated diagnostic bank',
    scored: true,
    note: 'Calibrated items in the DiagnosticItem table powering the scored adaptive diagnostic — the same source the Diagnostic Bank page reads. The live diagnostic serves PUBLISHED items; "calibrated" counts validated + published (the review-approved set). Draft and rejected items are excluded from serveable counts.',
    coverageLabel: 'Strand',
    hasStatus: false,
    total: items.length,
    serveable: serveableItems.length,
    byStatus,
    byGrade: sortGrades([...gradeMap.values()]),
    coverage,
    tags: null,
    defects,
    verification,
    verdict: { ready, blockers, warnings, summary },
  };
}

// ---- top-level -------------------------------------------------------------

export function buildIntegrityReport(
  rows: BankRow[],
  diagnosticItems: DiagnosticRow[] = [],
  opts: { maxUncheckedPct?: number } = {},
): IntegrityReport {
  const max = Number.isFinite(opts.maxUncheckedPct) && (opts.maxUncheckedPct as number) >= 0
    ? (opts.maxUncheckedPct as number)
    : DEFAULT_MAX_UNCHECKED_PCT;
  const generated = buildGeneratedSection(rows, max);
  const diagnostic = buildDiagnosticSection(diagnosticItems, max);
  const banks = [diagnostic, generated];

  const totalQuestions = banks.reduce((n, b) => n + b.total, 0);
  const sum = (k: 'total' | 'verified' | 'failed' | 'unchecked') => banks.reduce((n, b) => n + b.verification[k], 0);
  const vTotal = sum('total');
  const pct = (n: number) => (vTotal ? Math.round((n / vTotal) * 1000) / 10 : 0);
  const verification: VerificationSummary = {
    total: vTotal, verified: sum('verified'), failed: sum('failed'), unchecked: sum('unchecked'),
    verifiedPct: pct(sum('verified')), uncheckedPct: pct(sum('unchecked')), maxUncheckedPct: max,
  };
  const ready = banks.every((b) => b.verdict.ready);
  const notReady = banks.filter((b) => !b.verdict.ready).map((b) => b.label);
  const summary = `${verificationLine(verification)} ` + (ready
    ? `${totalQuestions} total questions across ${banks.length} banks — no blocking defects.`
    : `${totalQuestions} total questions. Blocking defects in: ${notReady.join(', ')}.`);

  return {
    generatedAt: new Date().toISOString(),
    combined: {
      totalQuestions,
      banks: banks.map((b) => ({ key: b.key, label: b.label, total: b.total, serveable: b.serveable })),
      verification,
      ready,
      summary,
    },
    banks,
  };
}
