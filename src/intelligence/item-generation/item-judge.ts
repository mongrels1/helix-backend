/**
 * EdKairos · the SINGLE item judge (PURE LOGIC)
 * ---------------------------------------------------------------------------
 * One door. Every item — practice (DraftItem) or scored (DiagnosticItem),
 * generated or imported — is judged here and nowhere else. Replaces the four
 * overlapping validators (reliability gate item-checks, factCheck, and the two
 * fail-open AI judges' role for computable items) with one verdict that the
 * generator, the import path, Validate-All, and the Verify Database sweep all
 * share.
 *
 * Composition (no duplication): structural checks live here; the answer re-solve
 * and figure-shape checks are the pure functions in item-resolver.ts; the small
 * text/figure predicates are reused from reliability-gate.ts. Nothing re-solves
 * math in more than one place.
 */
import { resolveItem, figureCompleteness, stemRequiresFigure } from './item-resolver';
import { figureIsSane, solutionLeaksReasoning, stemNotSelfContained } from './reliability-gate';
import { isRenderableFigure } from '../figures/figure-contract';

export type Bank = 'practice' | 'scored';
export type Severity = 'blocker' | 'warning';

export interface JudgeFinding { id: string; severity: Severity; message: string }
export interface JudgeResult {
  ok: boolean;               // true when there are NO blockers
  blockers: JudgeFinding[];
  warnings: JudgeFinding[];
  trueIndex: number | null;  // the option the re-solver believes is correct, when known
}

/** Permissive raw row — accepts a DraftItem (options {text,correct}) or a
 *  DiagnosticItem (options string[] + correct index). */
export interface RawItem {
  stem?: string | null;
  options?: unknown;
  correct?: number | null;
  answer?: string | null;
  solution?: string | null;
  standard?: string | null;
  figure?: unknown;
}

interface NormOption { text: string; keyed: boolean; tag: string }
interface NormItem {
  stem: string;
  options: NormOption[];
  answer: string;
  solution: string;
  standard: string;
  figure: unknown;
}

function normalize(raw: RawItem): NormItem {
  let arr: unknown = raw.options;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
  const list = Array.isArray(arr) ? arr : [];
  const options: NormOption[] = list.map((o) => {
    if (o && typeof o === 'object') {
      const r = o as { text?: unknown; correct?: unknown; misconceptionTag?: unknown };
      return { text: String(r.text ?? ''), keyed: r.correct === true, tag: String(r.misconceptionTag ?? '') };
    }
    return { text: String(o ?? ''), keyed: false, tag: '' };
  });
  if (typeof raw.correct === 'number' && raw.correct >= 0 && raw.correct < options.length) {
    options.forEach((o, i) => (o.keyed = i === raw.correct));
  } else if (!options.some((o) => o.keyed) && raw.answer != null) {
    const a = String(raw.answer).trim().toLowerCase();
    options.forEach((o) => (o.keyed = o.text.trim().toLowerCase() === a));
  }
  return {
    stem: String(raw.stem ?? ''),
    options,
    answer: String(raw.answer ?? ''),
    solution: String(raw.solution ?? ''),
    standard: String(raw.standard ?? ''),
    figure: raw.figure,
  };
}

/**
 * Judge one item. `bank` selects the per-bank structural extras; the correctness
 * and figure checks are identical for both.
 */
export function judgeItem(raw: RawItem, bank: Bank): JudgeResult {
  const it = normalize(raw);
  const B: JudgeFinding[] = [];
  const W: JudgeFinding[] = [];
  const block = (id: string, message: string) => B.push({ id, severity: 'blocker', message });
  const warn = (id: string, message: string) => W.push({ id, severity: 'warning', message });

  // ---- shared structure ----
  if (!it.stem.trim()) block('has_stem', 'no question stem');
  const keyed = it.options.filter((o) => o.keyed).length;
  if (keyed !== 1) block('one_correct_option', `must have exactly one correct option (has ${keyed})`);
  if (it.options.some((o) => !o.text.trim())) block('option_text', 'an option is blank');
  const texts = it.options.map((o) => o.text.trim().toLowerCase());
  if (new Set(texts).size !== texts.length) block('duplicate_options', 'two options are identical');

  // ---- per-bank structure ----
  if (bank === 'practice') {
    if (it.options.length !== 4) block('four_options', `practice items need exactly 4 options (has ${it.options.length})`);
    if (!it.answer.trim()) block('has_answer', 'no answer');
    if (!it.solution.trim()) block('has_solution', 'no worked solution');
    if (it.solution.trim() && solutionLeaksReasoning(it.solution)) warn('solution_leaked', 'worked solution rambles or self-corrects');
    if (it.options.some((o) => !o.keyed && !o.tag.trim())) warn('distractors_tagged', 'a distractor has no misconception tag');
  } else {
    if (it.options.length < 2) block('min_options', 'scored items need at least 2 options');
    if (!it.standard.trim()) warn('has_standard', 'no standard — cannot verify alignment');
  }
  if (stemNotSelfContained(it.stem)) warn('stem_not_self_contained', 'stem refers to earlier context the student cannot see');

  // ---- correctness (the deterministic re-solve — one implementation) ----
  const rr = resolveItem({ stem: it.stem, options: raw.options, correct: raw.correct, answer: raw.answer, standard: it.standard, figure: it.figure });
  if (rr.verdict === 'mis_keyed') block('mis_keyed', `keyed answer is not the computed answer (${rr.family})`);
  else if (rr.verdict === 'no_correct_option') block('no_correct_option', `computed answer matches no option (${rr.family})`);
  else if (rr.verdict === 'ambiguous') block('ambiguous', `more than one option is defensibly correct (${rr.family})`);

  // ---- figure (one implementation, shared) ----
  const fc = figureCompleteness(it.stem, it.figure);
  if (fc.verdict === 'incomplete') block('figure_incomplete', fc.reason ?? 'figure does not match the shape described');
  else if (fc.verdict === 'missing') block('figure_missing', fc.reason ?? 'stem describes a figure that is not attached');
  if (fc.verdict === 'na' && !it.figure && stemRequiresFigure(it.stem)) block('figure_missing_referenced', 'stem references a figure that is not attached');
  if (it.figure) {
    // Canonical contract: a figure whose type/fields don't match the renderer would
    // show as a blank box. Surface it (write paths strip/reject these before save;
    // this flags any that already reached the DB so the sweep can find them).
    if (!isRenderableFigure(it.figure)) warn('figure_unrenderable', 'figure spec does not match any renderer type/shape — it would show as a blank box');
    const sane = figureIsSane(it.figure, `${it.stem} ${it.options.map((o) => o.text).join(' ')}`);
    if (!sane.ok) warn('figure_unsound', sane.reason ?? 'figure numbers do not match the item');
  }

  return { ok: B.length === 0, blockers: B, warnings: W, trueIndex: rr.trueIndex };
}
