import {
  expectationsForGrade,
  type GaExpectation,
  type GaStrand,
} from '../standards/ga-standards';
// GA_STRANDS is declared in the data file and not re-exported by the registry
// barrel, so it is imported from source rather than added to that public surface.
import { GA_STRANDS } from '../standards/ga-standards.data';
import type {
  DomainTrack,
  ExtractedDomain,
  PushMap,
  ScoreExtraction,
  Track,
} from './push-map.types';

/**
 * The Push Map rule, and the plan it produces. Pure — no I/O, no AI.
 *
 * Keeping this dependency-free is deliberate: the composition is deterministic,
 * so the same report always produces the same plan, and the parts that could
 * hallucinate (reading numbers off a document) are quarantined in the extractor
 * behind a human confirmation step.
 */

/**
 * How many grades above the floor a PUSH strand may draw from.
 *
 * The product dial. Standard is 0 — readiness is still detected for every
 * learner and answered with harder items *at* their grade, which is what
 * Playbook §7 requires. Above-Grade is 1. Fellows is 2.
 */
export const REACH_BY_PRODUCT: Record<string, number> = {
  STANDARD: 0,
  ABOVE_GRADE: 1,
  LEGACY: 0,
  FELLOWS: 2,
  INSTITUTIONAL: 0,
  STAFF: 1,
  PAID_UNKNOWN: 0,
  NONE: 0,
};

/**
 * When an instrument prints no standard error, assume this much noise before
 * believing a domain gap. Deliberately not zero: i-Ready reports ±8 on a scale
 * where domains span ~26 points, so a handful of points is never a signal.
 */
const DEFAULT_NOISE_BAND = 8;

/**
 * Vendor domain wording → Georgia strand.
 *
 * Matched on a normalised substring so "Number and Operations", "Numbers and
 * Operations" and "Operations & Algebraic Thinking" all land. Anything
 * unmatched returns null and the confirm screen asks a human — it is never
 * guessed into a strand, because a wrong strand sends a child to the wrong work.
 */
const STRAND_PATTERNS: { match: RegExp; strand: GaStrand }[] = [
  { match: /algebra|algebraic|expressions?\s*(&|and)?\s*equations?|patterns?/i, strand: 'PAR' },
  { match: /geometr|spatial|shapes?/i, strand: 'GSR' },
  { match: /measurement|data|statistic/i, strand: 'MDR' },
  { match: /probability|chance/i, strand: 'PR' },
  { match: /function/i, strand: 'FGR' },
  // Last: "Number and Operations" also contains "Operations", which several
  // vendors attach to algebraic thinking. Algebra is tested first for that
  // reason, and this is the catch-all for anything numeric.
  { match: /number|numeric|operations?|computation|fractions?|decimals?/i, strand: 'NR' },
];

export function strandForVendorDomain(name: string): GaStrand | null {
  const n = String(name ?? '').trim();
  if (!n) return null;
  for (const { match, strand } of STRAND_PATTERNS) {
    if (match.test(n)) return strand;
  }
  return null;
}

export function strandLabel(strand: GaStrand | null): string {
  return strand ? (GA_STRANDS[strand] ?? strand) : 'Unmapped';
}

/**
 * ★ The rule.
 *
 * Each domain is compared to the student's **own** overall score. At or above →
 * PUSH. Below → STRENGTHEN. No absolute cutoff, so it works for a struggling
 * student and a top-decile one alike; every learner has domains on both sides of
 * their own centre.
 *
 * The floor is always the enrolled grade and never rises. PUSH raises only the
 * ceiling.
 */
export function assignTracks(
  domains: ExtractedDomain[],
  overall: number,
  enrolledGrade: number,
  opts: { reach?: number; noiseBand?: number | null } = {},
): DomainTrack[] {
  const reach = opts.reach ?? 1;
  const noise = opts.noiseBand ?? DEFAULT_NOISE_BAND;

  return domains
    .filter((d): d is ExtractedDomain & { score: number } => typeof d.score === 'number')
    .map((d) => {
      const delta = d.score - overall;
      const provisional = Math.abs(delta) < noise;
      // Provisional gaps default to STRENGTHEN. Pushing a child on a difference
      // smaller than the instrument's own error is how you accelerate someone
      // into work they are not ready for.
      const track: Track = delta >= 0 && !provisional ? 'PUSH' : 'STRENGTHEN';
      return {
        name: d.name,
        strand: d.strand ?? strandForVendorDomain(d.name),
        score: d.score,
        delta,
        track,
        gradeFloor: enrolledGrade,
        gradeCeiling: track === 'PUSH' ? enrolledGrade + reach : enrolledGrade,
        provisional,
      };
    })
    .sort((a, b) => b.delta - a.delta);
}

/** Standards for one strand at one grade, as short display lines. */
function standardsFor(strand: GaStrand | null, grade: number, limit = 6): string[] {
  if (!strand) return [];
  return (expectationsForGrade(grade) as GaExpectation[])
    .filter((e) => e.strand === strand)
    .slice(0, limit)
    .map((e) => `${e.code} — ${e.text}`);
}

/**
 * Was this taken in the opening weeks of the school year?
 *
 * ★ The single most useful thing the report can tell a parent. A test taken in
 * August measures a child **before the year was taught**, so its placement label
 * reads low by construction — and comparing it to one taken the previous May is
 * what makes a parent believe their child has gone backwards. It is exactly what
 * happened with the report that prompted this feature.
 */
export function isEarlyInSchoolYear(takenOn: string | null): boolean {
  if (!takenOn) return false;
  const d = new Date(takenOn);
  if (Number.isNaN(d.getTime())) return false;
  const m = d.getUTCMonth(); // 0-based
  const day = d.getUTCDate();
  // Late July through the end of September.
  return (m === 6 && day >= 20) || m === 7 || m === 8;
}

/**
 * The Kairos Point — the named opening paragraph.
 *
 * Deliberately assembled rather than generated. It is the sentence a parent will
 * act on, so it says only what the numbers support: the percentile is quoted as
 * the instrument's finding, the push strands are named, and the date caveat is
 * stated whenever it applies. No placement claim, ever.
 */
function composeKairosPoint(
  firstName: string,
  extraction: ScoreExtraction,
  push: DomainTrack[],
  earlyInYear: boolean,
): string {
  const parts: string[] = [];

  if (typeof extraction.percentile === 'number') {
    const top = 100 - extraction.percentile;
    parts.push(
      `${firstName} is in the top ${top}% of ${ordinal(extraction.studentGrade)} graders nationally on this assessment.`,
    );
  }

  if (push.length > 0) {
    const names = listify(push.map((d) => d.name));
    parts.push(`He is ready to work above grade in ${names} — now.`);
  } else {
    parts.push(
      `Every area came back on grade level, and the plan below is built on where ${firstName} is strongest relative to himself.`,
    );
  }

  if (earlyInYear && extraction.overall.label) {
    parts.push(
      `The report says "${extraction.overall.label}" because it was taken in the opening weeks of the school year, before the year had been taught. That is a starting line, not a result.`,
    );
  }

  return parts.join(' ');
}

function ordinal(n: number | null): string {
  if (n === null) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function listify(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Assemble the whole map from a confirmed extraction. */
export function composePushMap(
  studentName: string,
  extraction: ScoreExtraction,
  opts: { reach?: number } = {},
): PushMap {
  const overall = extraction.overall.score;
  const grade = extraction.studentGrade;
  if (overall === null || grade === null) {
    throw new Error('An overall score and a grade are required to build a Push Map.');
  }

  const domains = assignTracks(extraction.domains, overall, grade, {
    reach: opts.reach ?? 1,
    noiseBand: extraction.overall.standardError,
  });
  const push = domains.filter((d) => d.track === 'PUSH');
  const strengthen = domains.filter((d) => d.track === 'STRENGTHEN');
  const earlyInYear = isEarlyInSchoolYear(extraction.takenOn);
  const firstName = studentName.trim().split(/\s+/)[0] || studentName;

  return {
    studentName,
    studentGrade: grade,
    assessmentName: extraction.assessmentName ?? 'the assessment',
    takenOn: extraction.takenOn,
    overall,
    percentile: extraction.percentile,
    kairosPoint: composeKairosPoint(firstName, extraction, push, earlyInYear),
    earlyInYear,
    domains,
    push,
    strengthen,
    plan: {
      push: push.map((d) => ({
        strand: strandLabel(d.strand),
        grade: d.gradeCeiling,
        standards: standardsFor(d.strand, d.gradeCeiling),
      })),
      strengthen: strengthen.map((d) => ({
        strand: strandLabel(d.strand),
        grade: d.gradeFloor,
        standards: standardsFor(d.strand, d.gradeFloor),
      })),
    },
    growthTargets: {
      baseline: overall,
      typical: extraction.growthTargets.typical,
      stretch: extraction.growthTargets.stretch,
    },
    generatedAt: new Date().toISOString(),
  };
}
