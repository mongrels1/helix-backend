/**
 * EdKairos — acceleration evidence.
 * ---------------------------------------------------------------------------
 * WHAT THIS ANSWERS
 *
 * "Which Georgia standards has this student actually demonstrated, and where do
 * they sit relative to the grade they are enrolled in?"
 *
 * WHY IT IS PHRASED THAT WAY ROUND
 *
 * The tempting headline is "two grades ahead." Do not build on it. The
 * denominator — `DiagnosticSession.grade` — is a free-form string somebody typed
 * at signup and nobody verified. It can be blank, stale, mistyped, or entered
 * before the child was accelerated. A "+2" computed against a typo is a typo.
 *
 * What survives being questioned is the STANDARD: "answered five items on
 * 7.NR.1 correctly, on these dates." That is a fact about what the student did.
 * It names the exact competency, it can be checked, it does not depend on a
 * parent's data entry, and it is the form a placement officer or a district
 * reviewer can act on.
 *
 * So this service leads with demonstrated standards and treats the grade delta
 * as a derived footnote, explicitly labelled as resting on self-reported data.
 * Every consumer gets `gradeSelfReported` alongside any delta so the caveat
 * cannot be silently dropped downstream.
 *
 * This became computable only once every item carried a real Georgia code —
 * see ga-standards.ts. Before that, `PracticeResponse.standard` held a mixture
 * of legacy MGSE codes, CCSS codes and at least one code that did not exist.
 *
 * SCOPE: evidence for staff. Nothing here is written for a child or a parent to
 * read. EdKairos does not promise a placement — "we prepare the case, the
 * school decides" — so this produces documentation, never a claim.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveToGa, gaLabel, type GaExpectation } from './ga-standards';

/** How many correct responses on a standard before we will call it demonstrated. */
const DEMONSTRATED_MIN_CORRECT = 3;

/** How many correct responses at a grade before we will call that grade reached. */
const GRADE_REACHED_MIN_CORRECT = 5;

export interface DemonstratedStandard {
  code: string;
  label: string;
  grade: string;
  gradeNum: number;
  strandName: string;
  correct: number;
  attempted: number;
  firstAt: Date;
  lastAt: Date;
  /** correct >= DEMONSTRATED_MIN_CORRECT */
  demonstrated: boolean;
}

export interface AccelerationEvidence {
  userId: string;

  /** THE HEADLINE. Standards the student has answered correctly, highest grade first. */
  standards: DemonstratedStandard[];

  /** Standards meeting the demonstrated bar, grouped by the Georgia grade that owns them. */
  byGrade: { grade: string; gradeNum: number; standards: string[]; correct: number }[];

  /** Highest Georgia grade at which the student has cleared GRADE_REACHED_MIN_CORRECT. */
  highestGradeReached: { grade: string; gradeNum: number; correct: number } | null;

  /**
   * The enrolment grade, and everything that depends on it. SELF-REPORTED —
   * a free-form string entered at signup, never verified. Treat as context,
   * not measurement.
   */
  enrolment: {
    gradeRaw: string | null;
    gradeNum: number | null;
    /** highestGradeReached - enrolment grade. null when the grade is unusable. */
    gradesAbove: number | null;
    /** Always true. Present so no consumer can render the delta without the caveat. */
    gradeSelfReported: true;
    caveat: string;
  };

  /** The measured signal, for comparison. IRT ability from the latest diagnostic. */
  diagnostic: { theta: number; se: number; completedAt: Date } | null;

  /** One line of plain English, safe to paste into a pathway document. */
  summary: string;

  totals: { responses: number; correct: number; standardsTouched: number };
}

const GRADE_CAVEAT =
  'Enrolment grade is self-reported at signup and is not verified. Any comparison against it is context, not measurement — cite the demonstrated standards instead.';

@Injectable()
export class AccelerationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parse the free-form grade string ("4", "Grade 4", "K", "fifth"). */
  private parseGrade(raw?: string | null): number | null {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;
    if (s.startsWith('k') || s.includes('kinder')) return 0;
    const m = s.match(/(\d{1,2})/);
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 0 && n <= 12 ? n : null;
  }

  private gradeName(n: number): string {
    return n === 0 ? 'K' : String(n);
  }

  async evidenceFor(userId: string): Promise<AccelerationEvidence> {
    const [responses, session] = await Promise.all([
      this.prisma.practiceResponse.findMany({
        where: { userId, standard: { not: null } },
        orderBy: { createdAt: 'asc' },
        take: 2000,
      }),
      this.prisma.diagnosticSession.findFirst({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        select: { grade: true, theta: true, se: true, completedAt: true },
      }),
    ]);

    // Roll responses up per Georgia learning objective. Anything that will not
    // resolve to a real Georgia standard is dropped rather than guessed at —
    // an unresolvable code is exactly the legacy data this evidence must not
    // quietly launder into a claim.
    const acc = new Map<string, DemonstratedStandard>();
    let correctTotal = 0;

    for (const r of responses) {
      const res = resolveToGa(String(r.standard));
      const exp: GaExpectation | null = res.expectation;
      const hit = exp ?? null;
      const code = hit?.code ?? res.cluster?.code;
      if (!code || !res.cluster) continue;

      const grade = hit?.grade ?? res.cluster.grade;
      const gradeNum = hit?.gradeNum ?? res.cluster.gradeNum;
      const strandName = hit?.strandName ?? res.cluster.strandName;

      const cur = acc.get(code) ?? {
        code,
        label: gaLabel(code),
        grade,
        gradeNum,
        strandName,
        correct: 0,
        attempted: 0,
        firstAt: r.createdAt,
        lastAt: r.createdAt,
        demonstrated: false,
      };
      cur.attempted += 1;
      if (r.correct) {
        cur.correct += 1;
        correctTotal += 1;
      }
      if (r.createdAt < cur.firstAt) cur.firstAt = r.createdAt;
      if (r.createdAt > cur.lastAt) cur.lastAt = r.createdAt;
      acc.set(code, cur);
    }

    const standards = [...acc.values()]
      .map((s) => ({ ...s, demonstrated: s.correct >= DEMONSTRATED_MIN_CORRECT }))
      .sort((a, b) => b.gradeNum - a.gradeNum || b.correct - a.correct || a.code.localeCompare(b.code));

    // Group the demonstrated ones by the Georgia grade that owns them.
    const grades = new Map<number, { grade: string; gradeNum: number; standards: string[]; correct: number }>();
    for (const s of standards) {
      if (!s.demonstrated) continue;
      const g = grades.get(s.gradeNum) ?? {
        grade: s.grade, gradeNum: s.gradeNum, standards: [], correct: 0,
      };
      g.standards.push(s.code);
      g.correct += s.correct;
      grades.set(s.gradeNum, g);
    }
    const byGrade = [...grades.values()].sort((a, b) => b.gradeNum - a.gradeNum);

    const highestGradeReached =
      byGrade.find((g) => g.correct >= GRADE_REACHED_MIN_CORRECT) ?? null;

    const gradeRaw = session?.grade ?? null;
    const gradeNum = this.parseGrade(gradeRaw);
    const gradesAbove =
      highestGradeReached && gradeNum !== null ? highestGradeReached.gradeNum - gradeNum : null;

    return {
      userId,
      standards,
      byGrade,
      highestGradeReached: highestGradeReached
        ? { grade: highestGradeReached.grade, gradeNum: highestGradeReached.gradeNum, correct: highestGradeReached.correct }
        : null,
      enrolment: {
        gradeRaw,
        gradeNum,
        gradesAbove,
        gradeSelfReported: true,
        caveat: GRADE_CAVEAT,
      },
      diagnostic: session
        ? { theta: session.theta, se: session.se, completedAt: session.completedAt }
        : null,
      summary: this.summarise(standards, byGrade, highestGradeReached, gradeNum),
      totals: {
        responses: responses.length,
        correct: correctTotal,
        standardsTouched: standards.length,
      },
    };
  }

  /**
   * One sentence a human can paste into a pathway document. Leads with the
   * standards; mentions the grade only as a qualified aside. Deliberately makes
   * no claim about placement, readiness, or ability.
   */
  private summarise(
    standards: DemonstratedStandard[],
    byGrade: { grade: string; standards: string[]; correct: number }[],
    highest: { grade: string; gradeNum: number; correct: number } | null,
    enrolmentGrade: number | null,
  ): string {
    const demonstrated = standards.filter((s) => s.demonstrated);
    if (!demonstrated.length) {
      return 'No Georgia standard has yet been answered correctly enough times to be recorded as demonstrated.';
    }
    const parts = byGrade
      .slice(0, 3)
      .map((g) => `grade ${g.grade} (${g.standards.join(', ')})`);
    let s = `Has demonstrated ${demonstrated.length} Georgia ${
      demonstrated.length === 1 ? 'standard' : 'standards'
    } across ${parts.join('; ')}.`;

    if (highest && enrolmentGrade !== null && highest.gradeNum > enrolmentGrade) {
      const n = highest.gradeNum - enrolmentGrade;
      s += ` The highest of these sits ${n} ${n === 1 ? 'grade' : 'grades'} above the grade recorded at signup (${this.gradeName(
        enrolmentGrade,
      )}), which is self-reported and unverified.`;
    }
    return s;
  }

  /**
   * Cohort view: students with demonstrated standards above their recorded
   * grade. For a teacher or strategist scanning for candidates — NOT a
   * shortlist, and not to be shown to families as a selection.
   */
  async cohort(userIds: string[]): Promise<AccelerationEvidence[]> {
    const out: AccelerationEvidence[] = [];
    for (const id of userIds.slice(0, 200)) out.push(await this.evidenceFor(id));
    return out.sort(
      (a, b) => (b.enrolment.gradesAbove ?? -99) - (a.enrolment.gradesAbove ?? -99),
    );
  }
}
