import type { GaStrand } from '../standards/ga-standards';

/**
 * The Push Map — types and the extraction contract.
 *
 * A parent uploads the standardized score report they already have; EdKairos
 * reads it, shows what it read for confirmation, and returns a one-page plan.
 *
 * ## The rule the whole thing rests on
 *
 * **Compare each domain to the student's OWN overall score.** At or above →
 * PUSH (work from the grade above). Below → STRENGTHEN (at grade level).
 *
 * Self-referencing, which is what makes it work for every student rather than a
 * subgroup: everyone has domains above and below their own centre of gravity, a
 * struggling child and a top-decile child alike. There is no bar to clear.
 *
 * **The floor never rises.** A PUSH strand *adds* the grade above; it does not
 * remove the enrolled grade. Nothing is taken away from any student, ever.
 */

export type Vendor = 'IREADY' | 'MAP_GROWTH' | 'STAR' | 'GA_MILESTONES' | 'UNKNOWN';

/** One domain as the vendor reports it, before it is mapped to a GA strand. */
export interface ExtractedDomain {
  /** The vendor's own wording, kept verbatim so the confirm screen is recognisable. */
  name: string;
  score: number | null;
  /** e.g. "Mid 4". Vendor placement label, if any. */
  label?: string | null;
  /** Resolved GA strand. Null when the name is unrecognised — the UI asks. */
  strand?: GaStrand | null;
}

/**
 * What the extractor returns.
 *
 * ⚠ **Every field is nullable, and an unreadable field comes back null — never a
 * guess.** A number lifted off a document is a claim until a person has looked
 * at it, and a wrong scale score produces a confident, wrong plan. `unreadable`
 * names what could not be read so the confirm screen can flag it.
 */
export interface ScoreExtraction {
  vendor: Vendor;
  assessmentName: string | null;
  /** ISO date. ★ Load-bearing — see the note in `composePushMap`. */
  takenOn: string | null;
  studentGrade: number | null;
  overall: {
    score: number | null;
    label: string | null;
    /** Reported standard error, when the instrument prints one. */
    standardError: number | null;
  };
  percentile: number | null;
  domains: ExtractedDomain[];
  growthTargets: { typical: number | null; stretch: number | null };
  /** Field names the extractor could not read. Shown, never filled in. */
  unreadable: string[];
}

export type Track = 'PUSH' | 'STRENGTHEN';

export interface DomainTrack {
  name: string;
  strand: GaStrand | null;
  score: number;
  /** score − overall. */
  delta: number;
  track: Track;
  /** Enrolled grade. Never rises. */
  gradeFloor: number;
  /** Enrolled grade for STRENGTHEN; enrolled + reach for PUSH. */
  gradeCeiling: number;
  /**
   * |delta| is inside the instrument's standard error, so the assignment is not
   * yet evidence. Provisional domains default to STRENGTHEN and say so.
   */
  provisional: boolean;
}

export interface PushMap {
  studentName: string;
  studentGrade: number;
  assessmentName: string;
  takenOn: string | null;
  overall: number;
  percentile: number | null;
  /** The named opening paragraph. */
  kairosPoint: string;
  /** True when the report was taken in the opening weeks of the school year. */
  earlyInYear: boolean;
  domains: DomainTrack[];
  push: DomainTrack[];
  strengthen: DomainTrack[];
  /** Per-strand standards for each track, drawn from the GA registry. */
  plan: {
    push: { strand: string; grade: number; standards: string[] }[];
    strengthen: { strand: string; grade: number; standards: string[] }[];
  };
  growthTargets: { baseline: number | null; typical: number | null; stretch: number | null };
  generatedAt: string;
}
