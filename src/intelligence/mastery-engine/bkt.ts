/**
 * Growth Engine — Bayesian Knowledge Tracing (BKT) core.
 *
 * Pure, dependency-free math + parameters for the mastery model described in the
 * EdKairos Growth Engine Thesis. Mastery is a probability updated per response
 * (guess/slip aware), and a skill only locks when three conditions hold:
 * confidence >= THETA, breadth >= REQUIRED_VARIANTS, and rigor coverage.
 *
 * Defaults are literature-based Cognitive-Tutor values; every one is tunable and
 * intended to be calibrated per skill once response data accrues.
 */

export interface BktParams {
  /** P(L0): prior probability the skill is already mastered. */
  pL0: number;
  /** P(T): probability an unmastered skill transitions to mastered per opportunity. */
  pT: number;
  /** P(G): probability an unmastered learner answers correctly (guess). */
  pG: number;
  /** P(S): probability a mastered learner answers incorrectly (slip). */
  pS: number;
}

export const BKT_DEFAULTS: BktParams = {
  pL0: 0.25,
  pT: 0.15,
  pG: 0.2,
  pS: 0.1,
};

/** Mastery attainment threshold on the posterior (Cognitive Mastery Learning). */
export const MASTERY_THRESHOLD = 0.95;

/** Distinct correct application variants required before a skill can lock. */
export const REQUIRED_VARIANTS = 3;

/** Normalized-score cutoff at/above which an opportunity counts as correct. */
export const CORRECT_THRESHOLD = 0.6;

/** Days after mastery before a spaced re-check decays and reopens the skill. */
export const RECHECK_INTERVAL_DAYS = 14;

/** Cap on the simulated look-ahead when computing "how many more to lock". */
const MAX_LOOKAHEAD = 12;

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);

/**
 * One BKT update: condition the posterior on the observed evidence, then apply
 * the learning transition. Returns the updated P(mastered).
 */
export function bktUpdate(
  prior: number,
  correct: boolean,
  params: BktParams = BKT_DEFAULTS,
): number {
  const p = clamp01(prior);
  const { pT, pG, pS } = params;
  let posterior: number;
  if (correct) {
    const num = p * (1 - pS);
    const den = num + (1 - p) * pG;
    posterior = den > 0 ? num / den : p;
  } else {
    const num = p * pS;
    const den = num + (1 - p) * (1 - pG);
    posterior = den > 0 ? num / den : p;
  }
  return clamp01(posterior + (1 - posterior) * pT);
}

/**
 * Expected number of additional consecutive correct responses needed to push the
 * posterior from `p` to the mastery threshold. Simulated, capped at MAX_LOOKAHEAD.
 */
export function opportunitiesToThreshold(
  p: number,
  params: BktParams = BKT_DEFAULTS,
  threshold: number = MASTERY_THRESHOLD,
): number {
  let cur = clamp01(p);
  let n = 0;
  while (cur < threshold && n < MAX_LOOKAHEAD) {
    cur = bktUpdate(cur, true, params);
    n += 1;
  }
  return n;
}

export interface GateInputs {
  pMastered: number;
  /** Count of distinct correct application variants demonstrated. */
  variantsCorrect: number;
  /** Distinct rigor levels among correct attempts (empty if untagged). */
  rigorLevels: number[];
  params?: BktParams;
}

export interface GateResult {
  mastered: boolean;
  confidenceMet: boolean;
  breadthMet: boolean;
  rigorMet: boolean;
  variantsCorrect: number;
  variantsRequired: number;
  /** Additional correct opportunities the learner still needs to lock the skill. */
  remainingToLock: number;
}

/**
 * Rigor coverage rule (provisional, data-gated): satisfied when correct work
 * spans at least two distinct rigor levels. When rigor is untagged (no data), it
 * is not held against the learner — we never block on evidence we do not have.
 */
export function rigorCovered(rigorLevels: number[]): boolean {
  if (rigorLevels.length === 0) return true;
  return new Set(rigorLevels).size >= 2;
}

/** Evaluate the three-part mastery gate and compute "how many more to lock". */
export function evaluateGate(input: GateInputs): GateResult {
  const params = input.params ?? BKT_DEFAULTS;
  const confidenceMet = input.pMastered >= MASTERY_THRESHOLD;
  const breadthMet = input.variantsCorrect >= REQUIRED_VARIANTS;
  const rigorMet = rigorCovered(input.rigorLevels);
  const mastered = confidenceMet && breadthMet && rigorMet;

  const needConfidence = opportunitiesToThreshold(input.pMastered, params);
  const needBreadth = Math.max(0, REQUIRED_VARIANTS - input.variantsCorrect);
  const remainingToLock = mastered ? 0 : Math.max(needConfidence, needBreadth, 1);

  return {
    mastered,
    confidenceMet,
    breadthMet,
    rigorMet,
    variantsCorrect: input.variantsCorrect,
    variantsRequired: REQUIRED_VARIANTS,
    remainingToLock,
  };
}

/**
 * Spaced-retention decay: regress a mastered posterior halfway back toward the
 * prior when a re-check comes due, so retained skill must be re-demonstrated.
 */
export function decayedPosterior(
  p: number,
  params: BktParams = BKT_DEFAULTS,
): number {
  return clamp01(params.pL0 + (p - params.pL0) * 0.5);
}
