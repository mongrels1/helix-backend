/**
 * EdKairos · item-generation · database integrity report (PURE LOGIC)
 * ---------------------------------------------------------------------------
 * Aggregates the whole DraftItem bank for the Super-Admin "Verify Database"
 * gate that runs before opening sales. No NestJS — importable + unit-testable,
 * runnable directly against a list of rows.
 *
 * Reports four things, then a go / no-go verdict:
 *   1. Coverage  — counts by grade, standard (GA cluster), tag, and status.
 *   2. Structure — every serveable item has 4 options, exactly one correct,
 *      text everywhere, an answer, a solution, and tagged distractors.
 *   3. Format    — standards stored as GA (e.g. "6.NR.4") instead of MGSE, or a
 *      missing gaCluster, silently break targeted practice (strandOfStandard
 *      returns null). Flagged here so it can't reach buyers unnoticed.
 *   4. Duplicates — items sharing a normalized stem (bank padding).
 *
 * "Serveable" = anything a student can receive via practice: draft, validated,
 * field_test, operational. `rejected` is excluded everywhere (it is the pull
 * lever and never reaches students).
 */
import { CROSSWALK } from './mgse-ga-crosswalk';

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
}

export type Severity = 'blocker' | 'warning' | 'info';

export interface DefectGroup {
  id: string;
  severity: Severity;
  message: string;
  count: number;
  sampleIds: string[];
}

export interface CoverageEntry {
  cluster: string;
  grade: number | null;
  title?: string;
  gaCodes: string[];
  total: number;
  serveable: number;
  byStatus: Record<string, number>;
}

export interface IntegrityReport {
  generatedAt: string;
  totals: {
    total: number;
    serveable: number;
    rejected: number;
    byStatus: Record<string, number>;
    standardsCovered: number;
    gradesCovered: number[];
  };
  coverage: CoverageEntry[];
  byGrade: { grade: number | null; total: number; serveable: number }[];
  tags: {
    skill: { tag: string; count: number }[];
    misconception: { tag: string; count: number }[];
  };
  defects: DefectGroup[];
  verdict: {
    ready: boolean;
    blockers: number;
    warnings: number;
    summary: string;
  };
}

// ---- helpers ---------------------------------------------------------------

function normStem(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Grade from a GA cluster ("6.NR.4" -> 6) or MGSE code ("MGSE6.RP.1" -> 6). */
function gradeOf(row: BankRow): number | null {
  const src = String(row.gaCluster || row.ga || row.standard || '');
  const m = src.match(/(?:MGSE)?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

function clusterKeyOf(row: BankRow): string {
  return String(row.gaCluster || row.ga || row.standard || 'UNKNOWN').trim() || 'UNKNOWN';
}

interface ParsedOption { text: string; correct: boolean; tag: string }

function parseOptions(raw: unknown): ParsedOption[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { arr = []; }
  }
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

// ga code -> human title (for display only)
const TITLE_BY_GA = new Map(CROSSWALK.map((e) => [e.ga.toUpperCase(), e.title]));

function tally(rows: BankRow[], pick: (r: BankRow) => string[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) for (const t of pick(r)) {
    const key = String(t).trim();
    if (key) m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

function group(id: string, severity: Severity, message: string, ids: string[]): DefectGroup {
  return { id, severity, message, count: ids.length, sampleIds: ids.slice(0, 10) };
}

// ---- main ------------------------------------------------------------------

export function buildIntegrityReport(rows: BankRow[]): IntegrityReport {
  const serveable = rows.filter((r) => SERVEABLE.has(r.status));

  // ---- totals + per-status ----
  const byStatus: Record<string, number> = {};
  for (const s of ALL_STATUSES) byStatus[s] = 0;
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  // ---- coverage by cluster ----
  const covMap = new Map<string, CoverageEntry>();
  for (const r of rows) {
    const key = clusterKeyOf(r);
    let e = covMap.get(key);
    if (!e) {
      e = {
        cluster: key,
        grade: gradeOf(r),
        gaCodes: [],
        total: 0,
        serveable: 0,
        byStatus: Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<string, number>,
      };
      covMap.set(key, e);
    }
    e.total += 1;
    if (SERVEABLE.has(r.status)) e.serveable += 1;
    e.byStatus[r.status] = (e.byStatus[r.status] ?? 0) + 1;
    const ga = String(r.ga ?? '').trim();
    if (ga && !e.gaCodes.includes(ga)) {
      e.gaCodes.push(ga);
      if (!e.title) e.title = TITLE_BY_GA.get(ga.toUpperCase());
    }
  }
  const coverage = [...covMap.values()].sort((a, b) => a.cluster.localeCompare(b.cluster));

  // ---- by grade ----
  const gradeMap = new Map<number | null, { total: number; serveable: number }>();
  for (const r of rows) {
    const g = gradeOf(r);
    const e = gradeMap.get(g) ?? { total: 0, serveable: 0 };
    e.total += 1;
    if (SERVEABLE.has(r.status)) e.serveable += 1;
    gradeMap.set(g, e);
  }
  const byGrade = [...gradeMap.entries()]
    .map(([grade, v]) => ({ grade, ...v }))
    .sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99));

  // ---- structural + format + duplicate defects (serveable only) ----
  const badCorrect: string[] = [];
  const badCount: string[] = [];
  const emptyText: string[] = [];
  const noStem: string[] = [];
  const noAnswer: string[] = [];
  const noSolution: string[] = [];
  const untaggedDistractor: string[] = [];
  const notMgse: string[] = [];
  const noCluster: string[] = [];

  const stemBuckets = new Map<string, string[]>();

  for (const r of serveable) {
    const opts = parseOptions(r.options);
    const correct = opts.filter((o) => o.correct).length;
    if (correct !== 1) badCorrect.push(r.id);
    if (opts.length !== 4) badCount.push(r.id);
    if (opts.some((o) => !o.text.trim())) emptyText.push(r.id);
    if (opts.some((o) => !o.correct && !o.tag.trim())) untaggedDistractor.push(r.id);
    if (!String(r.stem ?? '').trim()) noStem.push(r.id);
    if (!String(r.answer ?? '').trim()) noAnswer.push(r.id);
    if (!String(r.solution ?? '').trim()) noSolution.push(r.id);

    const std = String(r.standard ?? '').trim();
    if (!/^MGSE/i.test(std)) notMgse.push(r.id);
    if (!String(r.gaCluster ?? '').trim()) noCluster.push(r.id);

    const key = normStem(r.stem);
    if (key) {
      const b = stemBuckets.get(key) ?? [];
      b.push(r.id);
      stemBuckets.set(key, b);
    }
  }

  const dupIds: string[] = [];
  let dupGroups = 0;
  for (const ids of stemBuckets.values()) {
    if (ids.length > 1) {
      dupGroups += 1;
      for (const id of ids.slice(1)) dupIds.push(id);
    }
  }

  const defects: DefectGroup[] = [];
  if (badCorrect.length) defects.push(group('one_correct_option', 'blocker', 'Items without exactly one correct option', badCorrect));
  if (badCount.length) defects.push(group('four_options', 'blocker', 'Items that do not have exactly four options', badCount));
  if (emptyText.length) defects.push(group('option_text', 'blocker', 'Items with a blank option', emptyText));
  if (noStem.length) defects.push(group('has_stem', 'blocker', 'Items with no question stem', noStem));
  if (noAnswer.length) defects.push(group('has_answer', 'blocker', 'Items with no answer', noAnswer));
  if (noSolution.length) defects.push(group('has_solution', 'blocker', 'Items with no worked solution', noSolution));
  if (untaggedDistractor.length) defects.push(group('distractors_tagged', 'warning', 'Items with an untagged distractor (no misconception tag)', untaggedDistractor));
  if (notMgse.length) defects.push(group('standard_not_mgse', 'warning', 'Serveable items whose standard is not MGSE-format — targeted practice cannot route these (they fall back to general practice)', notMgse));
  if (noCluster.length) defects.push(group('missing_ga_cluster', 'warning', 'Serveable items missing a GA cluster', noCluster));
  if (dupIds.length) defects.push(group('duplicate_stems', 'warning', `Duplicate stems across ${dupGroups} group(s) — extra copies beyond the first`, dupIds));

  const blockers = defects.filter((d) => d.severity === 'blocker').reduce((n, d) => n + 1, 0);
  const warnings = defects.filter((d) => d.severity === 'warning').reduce((n, d) => n + 1, 0);
  const ready = blockers === 0;

  const gradesCovered = byGrade.map((g) => g.grade).filter((g): g is number => g !== null);

  const summary = ready
    ? warnings === 0
      ? `Bank is clean: ${serveable.length} serveable items across ${coverage.length} standard(s), no defects.`
      : `No blocking defects. ${warnings} warning type(s) to review before sales.`
    : `${blockers} blocking defect type(s) reach students via practice — resolve (Reject in the generator) before opening sales.`;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      total: rows.length,
      serveable: serveable.length,
      rejected: byStatus['rejected'] ?? 0,
      byStatus,
      standardsCovered: coverage.filter((c) => c.serveable > 0).length,
      gradesCovered,
    },
    coverage,
    byGrade,
    tags: {
      skill: tally(serveable, (r) => r.skillTags ?? []),
      misconception: tally(serveable, (r) => r.misconceptionTags ?? []),
    },
    defects,
    verdict: { ready, blockers, warnings, summary },
  };
}
