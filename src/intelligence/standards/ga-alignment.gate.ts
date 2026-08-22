/**
 * EdKairos - Georgia alignment gate.
 * ---------------------------------------------------------------------------
 * A generated item is not allowed into the bank carrying a standard code that
 * Georgia does not have, or one from a different grade than the item it was
 * generated from. Both were possible before: the generator echoed whatever code
 * came in on the seed, and nothing ever checked the code against the standards.
 *
 * This is a CHEAP, DETERMINISTIC gate - no model call. It catches the two
 * failure modes that actually shipped:
 *   1. an invented or legacy code ("6.DSR.7", "MGSE6.RP.2") on a live item
 *   2. grade drift - a grade-6 seed producing a grade-7 item
 *
 * It deliberately does NOT judge whether the mathematics matches the standard.
 * That is the model judge's job (item-judge.ts); this is the passport check.
 */
import { resolveToGa, isValidGaCode, getExpectation, type GaResolution } from './ga-standards';

export interface GaAlignmentInput {
  /** the code the generated item is tagged with */
  standard?: string | null;
  /** the GA code, when the generator emitted one separately */
  ga?: string | null;
  /** the seed/base item's standard, for grade comparison */
  baseStandard?: string | null;
  /** explicit expected grade, when the caller knows it */
  expectedGrade?: number | null;
}

export interface GaAlignmentResult {
  ok: boolean;
  /** the code the item SHOULD carry - always a real GA code when ok */
  gaCode: string | null;
  gaCluster: string | null;
  grade: number | null;
  /** blocking problems */
  errors: string[];
  /** non-blocking - worth logging, worth showing an author */
  warnings: string[];
  resolution: GaResolution;
}

export function checkGaAlignment(input: GaAlignmentInput): GaAlignmentResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const raw = (input.ga || input.standard || '').trim();
  const r = resolveToGa(raw);

  if (!raw) {
    errors.push('Item carries no standard code.');
  } else if (r.unresolved) {
    errors.push(
      `"${raw}" is not a Georgia 2021 K-8 standard and could not be crosswalked to one.`,
    );
  }

  // A legacy or CCSS code is not an error on the way IN - it is an error to
  // STORE one as the item's standard. Say so, and hand back the GA code.
  if (!r.unresolved && r.inputSystem !== 'ga') {
    warnings.push(
      `Item was tagged with a ${r.inputSystem.toUpperCase()} code ("${raw}"); storing the Georgia equivalent instead.`,
    );
  }
  if (!r.unresolved && !r.exact) {
    warnings.push(
      `"${raw}" resolves only to the competency ${r.cluster?.code}, not to a single learning objective. ` +
        `Pick the specific objective before this item goes operational.`,
    );
  }

  const grade = r.expectation?.gradeNum ?? r.cluster?.gradeNum ?? null;

  // grade drift against the seed
  const expected =
    typeof input.expectedGrade === 'number'
      ? input.expectedGrade
      : input.baseStandard
        ? (resolveToGa(input.baseStandard).expectation?.gradeNum ??
           resolveToGa(input.baseStandard).cluster?.gradeNum ??
           null)
        : null;

  if (expected !== null && grade !== null && expected !== grade) {
    errors.push(
      `Grade drift: the seed is grade ${expected === 0 ? 'K' : expected} but the generated item is tagged ` +
        `grade ${grade === 0 ? 'K' : grade} (${r.expectation?.code ?? r.cluster?.code}).`,
    );
  }

  return {
    ok: errors.length === 0,
    gaCode: r.expectation?.code ?? r.cluster?.code ?? null,
    gaCluster: r.cluster?.code ?? null,
    grade,
    errors,
    warnings,
    resolution: r,
  };
}

/**
 * Normalise an item's standards fields in place-safe fashion: returns the
 * fields to write. Use at the point the generator's output is persisted.
 */
export function gaStandardFields(input: GaAlignmentInput): {
  standard: string | null;
  ga: string | null;
  gaCluster: string | null;
  gradeNum: number | null;
  alignmentOk: boolean;
  alignmentNotes: string[];
} {
  const a = checkGaAlignment(input);
  return {
    standard: a.gaCode,       // GA IS the stored standard - primary, not secondary
    ga: a.gaCode,
    gaCluster: a.gaCluster,
    gradeNum: a.grade,
    alignmentOk: a.ok,
    alignmentNotes: [...a.errors, ...a.warnings],
  };
}

/** Guard for anything that is about to SHOW a code to a teacher or district. */
export function assertShowableGaCode(code: string): void {
  if (!isValidGaCode(code)) {
    throw new Error(
      `Refusing to display "${code}" as a Georgia standard - it is not in Georgia's 2021 K-8 standards.`,
    );
  }
}

export { getExpectation };
