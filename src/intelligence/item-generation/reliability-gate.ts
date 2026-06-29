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
