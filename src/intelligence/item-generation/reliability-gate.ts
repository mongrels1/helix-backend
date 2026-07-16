/**
 * EdKairos · item-generation · reliability gate (PURE LOGIC)
 * The §4 validation rules. No NestJS — importable and unit-testable, runnable
 * directly against generated batches. validation.service.ts wraps this.
 */
import { MISCONCEPTION_IDS } from './misconception-library';
import type { GeneratedItem, ValidationReport } from './types';

const VALID = new Set<string>(MISCONCEPTION_IDS);
const CHART_FIGS = new Set([
  'ratio_table', 'bar_graph', 'dot_plot', 'histogram', 'function_table',
  'coordinate_grid', 'decimal_grid', 'place_value_chart',
]);

type Check = { id: string; ok: boolean; detail?: string };

function figType(it: GeneratedItem): string | null {
  const f = it.figure as any;
  if (!f) return null;
  if (typeof f === 'string') { try { return JSON.parse(f).type ?? null; } catch { return null; } }
  return (f.type as string) ?? null;
}
function numbersOf(s: string): string {
  return (s.match(/\d+\.?\d*/g) ?? []).map(Number).sort((a, b) => a - b).join(',');
}
function isMultiStep(it: GeneratedItem): boolean {
  return ['multi_step', 'compound', 'challenge'].includes(it.versionType) || /;/.test(it.solution);
}
/** all readable text of an item (stem + option texts) */
function itemText(it: GeneratedItem): string {
  return `${it.stem} ${(it.options ?? []).map((o) => o.text).join(' ')}`;
}
/** a proper fraction (3/4) or mixed number (2 1/2) appears in the quantities */
function hasFraction(it: GeneratedItem): boolean {
  const t = itemText(it);
  return /\d+\s+\d+\s*\/\s*\d+/.test(t) || /\b\d+\s*\/\s*\d+\b/.test(t);
}
/** a decimal quantity (7.25, $2.90) appears */
function hasDecimal(it: GeneratedItem): boolean {
  return /\d+\.\d+/.test(itemText(it));
}

/** the stem points at a figure/diagram/graph the item must actually carry */
function referencesFigure(it: GeneratedItem): boolean {
  const s = it.stem.toLowerCase();
  return (
    /\b(figure|diagram)\b/.test(s) ||
    /shown (below|above|here|in the)/.test(s) ||
    /\bthe (graph|table|number line|coordinate grid|coordinate plane|angle)\b/.test(s) ||
    /which (triangle|shape|figure|angle|rectangle|graph|number line)\b/.test(s) ||
    /lines? of symmetry/.test(s)
  );
}

/* ---------- double-key detection (deterministic; catches the recurring cases) ---------- */
function numsIn(s: string): number[] {
  return (s.match(/\d+\.?\d*/g) ?? []).map(Number);
}
/** the three numbers in the text form a Pythagorean (right) triangle */
function pythTriple(text: string): boolean {
  const n = numsIn(text);
  if (n.length !== 3) return false;
  const [a, b, c] = [...n].sort((x, y) => x - y);
  return a > 0 && Math.abs(a * a + b * b - c * c) < 1e-6;
}
/** the stem asks the student to pick a right triangle / perpendicular sides */
function asksRightTriangle(stem: string): boolean {
  const s = stem.toLowerCase();
  return /(right triangle|right angle|perpendicular|90[-\s]*degree)/.test(s) && /(triangle|sides)/.test(s);
}
const SYMMETRY_LINES: Record<string, number> = {
  'equilateral triangle': 3, 'isosceles triangle': 1, 'scalene triangle': 0, 'right triangle': 0,
  'square': 4, 'non-square rectangle': 2, 'rectangle': 2, 'rhombus': 2, 'parallelogram': 0,
  'isosceles trapezoid': 1, 'trapezoid': 0, 'regular pentagon': 5, 'regular hexagon': 6, 'regular octagon': 8,
};
/** lines of symmetry for a named shape in the option text, or null if unknown */
function symmetryOf(text: string): number | null {
  const t = text.toLowerCase();
  let best: string | null = null;
  for (const k of Object.keys(SYMMETRY_LINES)) if (t.includes(k) && (best === null || k.length > best.length)) best = k;
  return best !== null ? SYMMETRY_LINES[best] : null;
}
/** the target line-of-symmetry count the stem asks for, or null if not that kind of item */
function symmetryTarget(stem: string): number | null {
  const s = stem.toLowerCase();
  if (!/lines? of symmetry/.test(s)) return null;
  const m = s.match(/(\d+)\s+lines? of symmetry/) ?? s.match(/(?:exactly|has|have|with)\s+(\d+)\b/);
  if (m) return Number(m[1]);
  const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  for (const [w, v] of Object.entries(words)) if (new RegExp(`\\b${w}\\b\\s+lines? of symmetry`).test(s)) return v;
  return null;
}
/** normalize an option for equivalent-answer comparison (1/2 == 0.5) */
function normOpt(text: string): string {
  let t = text.toLowerCase().trim();
  t = t.replace(/(\d+)\s*\/\s*(\d+)/g, (_m, a, b) => String(Number(a) / Number(b)));
  t = t.replace(/\s+/g, ' ').replace(/[$,%]/g, '').trim();
  return t;
}
/** checks that flag an item having MORE THAN ONE defensible correct answer */
/* ---------- standard-code catalog: reject an item tagged with a GA cluster that
   does not exist for its grade (e.g. a generated "4.GSR.6" - grade 4 has no GSR.6;
   6 is 4.MDR.6). Verified against Georgia's K-12 Mathematics Standards (K-8). */
const GA_CLUSTERS = new Set<string>([
  'K.NR.1','K.NR.2','K.NR.3','K.NR.4','K.NR.5','K.PAR.6','K.MDR.7','K.GSR.8',
  '1.NR.1','1.NR.2','1.PAR.3','1.GSR.4','1.NR.5','1.MDR.6',
  '2.NR.1','2.NR.2','2.NR.3','2.PAR.4','2.MDR.5','2.MDR.6','2.GSR.7',
  '3.NR.1','3.PAR.2','3.PAR.3','3.NR.4','3.MDR.5','3.GSR.6','3.GSR.7','3.GSR.8',
  '4.NR.1','4.NR.2','4.PAR.3','4.NR.4','4.NR.5','4.MDR.6','4.GSR.7','4.GSR.8',
  '5.NR.1','5.NR.2','5.NR.3','5.NR.4','5.NR.5','5.PAR.6','5.MDR.7','5.GSR.8',
  '6.NR.1','6.NR.2','6.NR.3','6.NR.4','6.GSR.5','6.PAR.6','6.PAR.7','6.PAR.8',
  '7.NR.1','7.PAR.2','7.PAR.3','7.PAR.4','7.GSR.5','7.PR.6',
  '8.NR.1','8.NR.2','8.PAR.3','8.PAR.4','8.FGR.5','8.FGR.6','8.FGR.7','8.GSR.8',
]);
/** the grade.STRAND.N cluster of a GA-format code (drops any .element suffix);
    null for MGSE / legacy / blank codes, which this rule leaves untouched. */
function clusterOf(std: string | undefined): string | null {
  const m = /^([K1-8])\.([A-Z]{2,4})\.(\d{1,2})/.exec(String(std ?? '').trim().toUpperCase());
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

function doubleKeyChecks(it: GeneratedItem): Check[] {
  const out: Check[] = [];
  const norm = (it.options ?? []).map((o) => normOpt(o.text));
  out.push({ id: 'no_duplicate_options', ok: norm.length === new Set(norm).size, detail: `${norm.length - new Set(norm).size} dup` });
  const tripleOpts = (it.options ?? []).filter((o) => numsIn(o.text).length === 3);
  if (asksRightTriangle(it.stem) && tripleOpts.length >= 2) {
    const rc = tripleOpts.filter((o) => pythTriple(o.text)).length;
    out.push({ id: 'single_right_triangle', ok: rc === 1, detail: `${rc} right-triangle options` });
  }
  const symN = symmetryTarget(it.stem);
  if (symN !== null) {
    const matches = (it.options ?? []).filter((o) => { const v = symmetryOf(o.text); return v !== null && v === symN; }).length;
    out.push({ id: 'symmetry_answer_unique', ok: matches === 1, detail: `${matches} options with ${symN} lines` });
  }
  return out;
}

/** validate a single item */
export function gateItem(it: GeneratedItem): Check[] {
  const checks: Check[] = [];
  const correct = it.options.filter((o) => o.correct);
  checks.push({ id: 'one_correct_option', ok: correct.length === 1, detail: `${correct.length} correct` });
  const badTags = it.options.filter((o) => !o.correct && !VALID.has(o.misconceptionTag));
  checks.push({ id: 'distractors_tagged', ok: badTags.length === 0, detail: badTags.map((o) => o.misconceptionTag || '(empty)').join(',') });
  checks.push({ id: 'four_options', ok: it.options.length === 4, detail: `${it.options.length}` });
  checks.push({ id: 'options_have_text', ok: it.options.every((o) => !!o.text && o.text.trim().length > 0) });
  checks.push({ id: 'has_answer', ok: it.answer !== undefined && it.answer !== '' });
  checks.push({ id: 'has_solution', ok: !!it.solution && it.solution.length > 0 });
  checks.push({ id: 'has_signal', ok: !!it.microDiagnosticSignal });
  // A figure-referencing item must actually carry a figure. sanitizeFigure drops
  // mismatched pictures, which can leave a visual item figure-less; fail it rather
  // than ship a "see the figure below" item with nothing to see.
  const refsFig = referencesFigure(it);
  checks.push({ id: 'figure_present_when_referenced', ok: !refsFig || !!it.figure, detail: refsFig ? (it.figure ? 'present' : 'MISSING') : 'n/a' });
  const cl = clusterOf(it.standard);
  if (cl) checks.push({ id: 'standard_in_catalog', ok: GA_CLUSTERS.has(cl), detail: GA_CLUSTERS.has(cl) ? cl : `unknown GA standard ${cl}` });
  for (const c of doubleKeyChecks(it)) checks.push(c);
  return checks;
}

/** validate a slate (the N versions generated from one base item) */
export function gateSlate(items: GeneratedItem[]): ValidationReport {
  const checks: Check[] = [];
  const failed = items.filter((it) => gateItem(it).some((c) => !c.ok)).length;
  checks.push({ id: 'all_items_valid', ok: failed === 0, detail: `${failed} item(s) failed` });

  const ms = items.filter(isMultiStep).length;
  checks.push({ id: 'multi_step>=3', ok: ms >= 3, detail: `${ms}` });
  const figs = items.filter((i) => !!i.figure).length;
  checks.push({ id: 'figures>=2', ok: figs >= 2, detail: `${figs}` });
  const charts = items.filter((i) => { const t = figType(i); return t !== null && CHART_FIGS.has(t); }).length;
  checks.push({ id: 'chart_read>=1', ok: charts >= 1, detail: `${charts}` });
  const psych = items.filter((i) => i.versionType === 'psychology').length;
  checks.push({ id: 'psychology>=1', ok: psych >= 1, detail: `${psych}` });
  const fracs = items.filter(hasFraction).length;
  checks.push({ id: 'fractions>=1', ok: fracs >= 1, detail: `${fracs}` });
  const decs = items.filter(hasDecimal).length;
  checks.push({ id: 'decimals>=1', ok: decs >= 1, detail: `${decs}` });

  const ns = items.map((i) => numbersOf(i.stem));
  checks.push({ id: 'distinct_number_sets', ok: new Set(ns).size === ns.length, detail: `${ns.length - new Set(ns).size} dup` });
  const stems = items.map((i) => i.stem.trim().toLowerCase());
  checks.push({ id: 'distinct_contexts', ok: new Set(stems).size === stems.length });

  const passed = checks.every((c) => c.ok);
  const regenerateHints = checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail ?? 'failed'}`);
  return { passed, checks, regenerateHints };
}
