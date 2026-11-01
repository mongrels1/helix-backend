/**
 * EdKairos · golden error suite · shared types
 * ---------------------------------------------------------------------------
 * Every error ever found in EdKairos content becomes a case here BEFORE it is
 * fixed. A case says what SHOULD happen (`expect`) and what happens TODAY
 * (`known`):
 *
 *   known: 'caught' -> the check already does the right thing. The suite fails
 *                      if that ever stops being true (a regression).
 *   known: 'gap'    -> the check does NOT catch it yet. The suite records it
 *                      honestly and fails the day it starts being caught, so
 *                      the fixture is flipped to 'caught' and can never quietly
 *                      regress again (a ratchet).
 *
 * Nothing here is allowed to be silently skipped. The scorecard
 * (`scorecard.ts`) prints caught / gap per area, and CI writes it to the run
 * summary on every push.
 */
export type Known = 'caught' | 'gap';

export interface GoldenCase<TInput> {
  /** stable id, e.g. 'fig-circle-label-mismatch' */
  id: string;
  /** where the error came from: a commit, a doc, a test date */
  source: string;
  /** one line a non-developer can read */
  description: string;
  /** what should happen: 'blocked' (must be stopped) or 'clean' (must pass) */
  expect: 'blocked' | 'clean';
  /** what happens today; see header */
  known: Known;
  input: TInput;
}

export interface GoldenResult {
  id: string;
  area: string;
  description: string;
  expect: 'blocked' | 'clean';
  known: Known;
  actual: 'blocked' | 'clean';
  /** short reason from the check, for the scorecard */
  detail: string;
}
