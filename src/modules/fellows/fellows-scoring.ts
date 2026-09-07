/**
 * EdKairos Fellows — admissions screen scoring.
 * Admissions_Screen_Spec v2 · Renzulli three-ring · floors R2 >= 11/18, R3 >= 7/12,
 * FLOORED NOT SUMMED.
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH.
 * The copy that runs in the family's browser is a courtesy: it decides nothing.
 * Every band that reaches a human or an email is computed HERE, from raw items.
 *
 * No dependencies, no framework. TypeScript, so `nest build` emits it into dist alongside
 * everything else — a .js file here would be silently dropped by tsc.
 *
 * ── WHAT CHANGED IN v2, AND WHY ──────────────────────────────────────────────
 *
 * v1's Ring 1 gate required an "EdKairos diagnostic percentile >= 90".
 * **The EdKairos diagnostic does not produce a percentile and never has.** It produces a
 * Rasch theta, a provisional grade level (3.0-9.0), and Mastered/Emerging/Not-yet per
 * skill. Red_Lines already forbade claiming a percentile from it. See
 * `EdKairos_Fellows_Gate_Percentile_Does_Not_Exist_2026-09-07`.
 *
 * v2 replaces that single fictional number with the **five eligibility routes the Fellows
 * landing page has always advertised** — "any one of". Four are parent-reported claims;
 * one is machine-verifiable.
 *
 * The `pct < 95` band branch is also gone. It existed only to route 90th-95th families to
 * the $399 Placement Intensive, which was killed on 30 August (see KILLED_PRODUCTS.md).
 * With no product behind it, the threshold was residue.
 */

export const FLOOR2 = 11;   // Ring 2 — task commitment, out of 18
export const FLOOR3 = 7;    // Ring 3 — creativity, out of 12
export const THIN   = 25;   // words below which a child-authored answer is "thin"

export const BANDS = ['Not eligible', 'Defer', 'Standard tier', 'Human review', 'Admit'] as const;
export type Band = typeof BANDS[number];

export type RouteKey = 'ek' | 'gifted' | 'dl' | 'normed' | 'comp';

export interface Route {
  key: RouteKey;
  label: string;
  /** True only for the EdKairos route with a valid signed token. Everything else is a claim. */
  verifiable: boolean;
}

export const ROUTES: Record<RouteKey, Route> = {
  ek:     { key: 'ek',     label: 'EdKairos diagnostic, above grade level',   verifiable: true },
  gifted: { key: 'gifted', label: 'Gifted designation from a school/district', verifiable: false },
  dl:     { key: 'dl',     label: 'Distinguished Learner in mathematics',      verifiable: false },
  normed: { key: 'normed', label: '90th+ on a nationally normed test',         verifiable: false },
  comp:   { key: 'comp',   label: 'Competition result',                        verifiable: false },
};

export interface EkEvidence {
  /** The signed diagnostic claim, or null when there is no valid token. */
  verified: boolean;
  /** provisionalLevel() from the diagnostic: 3.0 – 9.0 in half steps. */
  level: number | null;
}

export interface Score {
  r2: number; r3: number; gate: boolean; band: Band;
  flags: string[]; w1: number; w3: number; w4: number;
  grade: number | null;
  routes: RouteKey[];          // every route the family satisfied
  routesClaimed: RouteKey[];   // every route they ticked, satisfied or not
  evidenceVerified: boolean;   // true only if the EdKairos route carried a valid token
  ekAboveGradeBy: number | null;
}

/** Radio items arrive as strings from an urlencoded body. Anything not 0..3 is null. */
export function item(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3) return null;
  return n;
}

/** Word count from the raw text — recomputed here, never trusted from the client. */
export function words(s: unknown): number {
  if (typeof s !== 'string') return 0;
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

function bandFor(w: number, big: number, mid: number, small: number): number {
  return w >= big ? 3 : (w >= mid ? 2 : (w >= small ? 1 : 0));
}

function ticked(v: unknown): boolean {
  return v === '1' || v === 1 || v === true || v === 'on';
}

function said(v: unknown, min = 2): boolean {
  return typeof v === 'string' && v.trim().length >= min;
}

/** Grade 6, 7 or 8. Anything else — including blank — is out of band. */
function gradeOf(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 6 && n <= 8 ? n : null;
}

/**
 * Which eligibility routes does this application actually satisfy?
 *
 * A parent-reported route needs its supporting detail before it counts. That is not
 * bureaucracy: a tick box alone is unaccountable, whereas naming the district that made
 * the designation, or the competition and the result, is a specific claim a person has
 * put their name to — and it is what makes the human review possible at all.
 */
export function evaluateRoutes(raw: Record<string, any>, ek: EkEvidence, grade: number | null) {
  const claimed: RouteKey[] = [];
  const met: RouteKey[] = [];
  const notes: string[] = [];

  if (ticked(raw.elig_ek)) {
    claimed.push('ek');
    if (!ek.verified || ek.level === null) {
      notes.push('EdKairos route claimed without a valid signed diagnostic result');
    } else if (grade === null) {
      notes.push('EdKairos route claimed but the grade is outside 6-8, so "above grade" has no meaning');
    } else if (ek.level - grade >= 1) {
      met.push('ek');
      // ⚠ BEFORE YOU TIGHTEN THIS THRESHOLD, OR REQUIRE THE LONG FORM, READ:
      //   `EdKairos_Diagnostic_Item_Bank_Ceiling_2026-09-07`
      //
      // The bank holds 8 items at b >= 1.5, one at b >= 2.0, and none at b >= 2.5. The
      // grade-8 cut here is theta 2.5 — above the top of the bank. Standard error at that
      // cut is ~0.6 GRADE YEARS against a threshold of exactly 1.0, so this test is close
      // to a coin flip at the boundary and cannot be made sharper by asking more questions
      // from a bank that stops short of the student.
      //
      // Forcing the long form was considered and rejected on 7 Sept: it buys ~15% and it
      // selects for a quiet room and an uninterrupted 45 minutes — family resources, and
      // the known mechanism by which gifted programmes under-identify low-income and ESL
      // students. Ten items written AT the cut beat seven more minutes outright.
      //
      // This is survivable only because `ek` is ONE OF FIVE routes. Do not make it the
      // gate, do not raise it above 1 year, and do not publish it as a placement claim.
    } else {
      notes.push(`EdKairos diagnostic placed the student at level ${ek.level} against grade ${grade} — not above grade`);
    }
  }

  if (ticked(raw.elig_gifted)) {
    claimed.push('gifted');
    if (said(raw.elig_gifted_detail)) met.push('gifted');
    else notes.push('Gifted designation claimed without naming the school or district that made it');
  }

  if (ticked(raw.elig_dl)) {
    claimed.push('dl');
    if (said(raw.elig_dl_year, 4)) met.push('dl');
    else notes.push('Distinguished Learner claimed without naming the year it was awarded');
  }

  if (ticked(raw.elig_normed)) {
    claimed.push('normed');
    const p = Number(raw.elig_normed_pct);
    if (!said(raw.elig_normed_test)) {
      notes.push('Normed-test route claimed without naming the test');
    } else if (!Number.isFinite(p) || p < 90 || p > 99) {
      notes.push(`Normed-test route claimed with a percentile of "${raw.elig_normed_pct}" — needs 90 to 99`);
    } else {
      met.push('normed');
    }
  }

  if (ticked(raw.elig_comp)) {
    claimed.push('comp');
    if (said(raw.elig_comp_detail, 4)) met.push('comp');
    else notes.push('Competition route claimed without naming the competition and the result');
  }

  return { claimed, met, notes };
}

export function score(
  raw: Record<string, any>,
  opts?: { ek?: EkEvidence },
): Score {
  const ek: EkEvidence = opts?.ek ?? { verified: false, level: null };

  const grade = gradeOf(raw.grade);
  const inGeorgia = item(raw.ga) === 1;

  const { claimed, met, notes } = evaluateRoutes(raw, ek, grade);

  // ── RING 1 · THE GATE ───────────────────────────────────────────────────────
  // Grades 6-8, Georgia, and at least one eligibility route actually satisfied.
  const gate = grade !== null && inGeorgia && met.length > 0;

  const a1 = item(raw.a1), a2 = item(raw.a2), a3 = item(raw.a3), a4 = item(raw.a4),
        a5 = item(raw.a5), a6 = item(raw.a6), a7 = item(raw.a7),
        b2 = item(raw.b2), b5 = item(raw.b5);

  const w1 = words(raw.b1), w3 = words(raw.b3), w4 = words(raw.b4);

  const b1s = bandFor(w1, THIN, 12, 4);
  const b3s = bandFor(w3, THIN, 12, 4);
  const b4s = bandFor(w4, 15,  6,  2);

  const r2 = [a1, a2, a3, a4, b2].reduce<number>((sum, v) => sum + (v ?? 0), 0) + b1s;
  const r3 = (a5 ?? 0) + (a6 ?? 0) + b3s + b4s;

  const flags: string[] = [...notes];
  let band: Band;

  if (!gate) {
    band = 'Not eligible';
  } else if (b5 === 0) {
    band = 'Defer';                                   // the child is not driving this
  } else if (a7 === 0) {
    band = 'Defer';                                   // under two hours a week
  } else if (r2 >= FLOOR2 && r3 >= FLOOR3 && (b5 ?? 0) >= 2 && (a7 ?? 0) >= 2) {
    band = 'Admit';
  } else if (r2 < FLOOR2 && r3 < FLOOR3) {
    band = 'Standard tier';                           // below both floors — redirect, never reject
  } else if (r2 + r3 >= 18 || b5 === 1) {
    band = 'Human review';                            // one floor missed, but close
  } else {
    band = 'Standard tier';                           // one floor missed, not close
  }

  // Consistency check — the inflating parent. Downgrades an Admit, never below Human review.
  if (gate && a1 !== null && a1 >= 2 && w1 > 0 && w1 < THIN) {
    flags.push('Parent reports weekly persistence; student wrote ' + w1 + ' words on B1');
    if (band === 'Admit') band = 'Human review';
  }
  if (gate && a5 !== null && a5 >= 2 && w3 > 0 && w3 < THIN) {
    flags.push('Parent reports unexpected solutions; student gave one method only on B3');
    if (band === 'Admit') band = 'Human review';
  }

  const evidenceVerified = met.includes('ek');

  return {
    r2, r3, gate, band, flags, w1, w3, w4,
    grade,
    routes: met,
    routesClaimed: claimed,
    evidenceVerified,
    ekAboveGradeBy: evidenceVerified && ek.level !== null && grade !== null
      ? Math.round((ek.level - grade) * 2) / 2
      : null,
  };
}
