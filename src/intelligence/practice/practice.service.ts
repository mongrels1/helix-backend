import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Pull the grade number out of a standard or GA cluster code, e.g. "MGSE6.RP.2" -> 6, "6.NR.4" -> 6. */
function gradeOf(s?: string | null): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve a generated item's diagnostic STRAND (NS/RP/EE/G/SP) from its MGSE
 * standard. This is the join key between the diagnostic (which tags weaknesses
 * by strand) and generated items (which are tagged by MGSE standard). Grade 4-5
 * MGSE domains collapse into the same five strands the diagnostic uses.
 */
function strandOfStandard(std?: string | null): string | null {
  const m = String(std ?? '').match(/MGSE\d+\.([A-Z]+)/i);
  if (!m) return null;
  const d = m[1].toUpperCase();
  if (d === 'RP') return 'RP';
  if (d === 'NS' || d === 'NBT' || d === 'NF' || d === 'OA') return 'NS';
  if (d === 'EE' || d === 'F') return 'EE';
  if (d === 'G') return 'G';
  if (d === 'SP' || d === 'MD') return 'SP';
  return d;
}

type RawOption = { text?: string; correct?: boolean; misconceptionTag?: string };

/** Consecutive-correct answers on one standard required before practice advances
 *  to the next standard. Tunable. */
const MASTERY_STREAK = 4;

interface WeakProfile {
  strands: Set<string>;
  kcs: Set<string>;
  tags: Set<string>;
  sessionId: string;
}

/**
 * Practice pool. Serves generated items to students as UNSCORED practice,
 * TARGETED to the skills the student was weak on in their latest diagnostic.
 *
 * Relationship to the diagnostic:
 *   diagnostic -> flags weak strands/KCs (+ the specific misconception missed)
 *   practice   -> serves generated items in those strands (this file, step 1)
 *   [step 2]   -> feeds the remediation re-check per weak KC w/ misconception match
 *
 * Items appear automatically the moment they're generated (saved as `draft`
 * after the reliability gate); `rejected` items are excluded. Practice is kept
 * separate from the SCORED adaptive diagnostic so uncalibrated items never touch
 * the measurement ruler.
 */
@Injectable()
export class PracticeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Weak strands/KCs/misconceptions from the student's most recent diagnostic. */
  private async weakProfile(userId?: string): Promise<WeakProfile | null> {
    if (!userId) return null;
    const session = await this.prisma.diagnosticSession.findFirst({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      include: { responses: true },
    });
    if (!session) return null;
    const strands = new Set<string>();
    const kcs = new Set<string>();
    const tags = new Set<string>();
    for (const r of session.responses) {
      if (!r.correct) {
        if (r.strand) strands.add(r.strand);
        if (r.kc) kcs.add(r.kc);
        if (r.tag) tags.add(r.tag);
      }
    }
    return { strands, kcs, tags, sessionId: session.id };
  }

  /**
   * The student's currently-active misconceptions: tags they PICKED on a wrong
   * practice answer within their most recent responses. Using a recent window
   * means a misconception naturally "cools" once they stop making that error.
   */
  private async activeMisconceptions(userId?: string): Promise<Set<string>> {
    const active = new Set<string>();
    if (!userId) return active;
    const recent = await this.prisma.practiceResponse.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    for (const r of recent) {
      if (!r.correct && r.misconceptionTag) active.add(r.misconceptionTag);
    }
    return active;
  }

  /** Record one practice answer; capture which misconception the student showed. */
  async recordResponse(userId: string | undefined, dto: { itemId: string; pickedIndex: number }) {
    if (!userId) return { recorded: false as const };
    const item = await this.prisma.draftItem.findUnique({ where: { id: dto.itemId } });
    if (!item) return { recorded: false as const };

    const opts = Array.isArray(item.options) ? (item.options as RawOption[]) : [];
    const idx = Number(dto.pickedIndex);
    const picked = opts[idx];
    const correct = !!picked?.correct;
    const misconceptionTag = correct ? null : picked?.misconceptionTag ?? null;

    await this.prisma.practiceResponse.create({
      data: {
        userId,
        draftItemId: item.id,
        standard: item.standard ?? null,
        strand: strandOfStandard(item.standard),
        pickedIndex: Number.isFinite(idx) ? idx : -1,
        correct,
        misconceptionTag,
      },
    });
    // Read back the updated consecutive-correct streak so the client can advance
    // to the next standard the moment this one is mastered.
    const standard = item.standard ?? null;
    const masteryStreak = standard ? await this.currentStreak(userId, standard) : 0;
    return {
      recorded: true as const,
      correct,
      misconceptionTag,
      standard,
      masteryStreak,
      masteryTarget: MASTERY_STREAK,
      mastered: masteryStreak >= MASTERY_STREAK,
    };
  }

  /** Author/teacher-facing summary of a student's misconceptions (never shown to students). */
  async misconceptionSummary(userId: string | undefined) {
    if (!userId) return { misconceptions: [] as { tag: string; count: number; lastSeen: Date }[] };
    const wrong = await this.prisma.practiceResponse.findMany({
      where: { userId, correct: false, misconceptionTag: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const map = new Map<string, { tag: string; count: number; lastSeen: Date }>();
    for (const r of wrong) {
      const tag = r.misconceptionTag as string;
      const cur = map.get(tag);
      if (cur) cur.count += 1;
      else map.set(tag, { tag, count: 1, lastSeen: r.createdAt });
    }
    return { misconceptions: [...map.values()].sort((a, b) => b.count - a.count) };
  }

  async items(userId: string | undefined, q: { grade?: string; standard?: string; limit?: string }) {
    const take = Math.min(Math.max(Number(q.limit) || 20, 1), 100);

    const where: { status: { in: ('draft' | 'field_test' | 'operational')[] }; standard?: { contains: string } } = {
      status: { in: ['draft', 'field_test', 'operational'] },
    };
    if (q.standard) where.standard = { contains: String(q.standard) };

    const rows = await this.prisma.draftItem.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const wantGrade = q.grade ? Number(q.grade) : null;

    let shaped = rows
      .map((r) => {
        const optsRaw = Array.isArray(r.options) ? (r.options as RawOption[]) : [];
        const options = optsRaw.map((o) => ({
          text: String(o?.text ?? ''),
          correct: !!o?.correct,
          misconceptionTag: o?.misconceptionTag ?? null,
        }));
        return {
          id: r.id,
          stem: r.stem,
          figure: r.figure ?? null,
          options,
          standard: r.standard,
          gaCluster: r.gaCluster ?? null,
          strand: strandOfStandard(r.standard),
          grade: gradeOf(r.standard) ?? gradeOf(r.gaCluster),
          skillTags: r.skillTags ?? [],
          dok: r.dok,
          difficulty: r.difficulty,
          solution: r.solution,
          status: r.status,
        };
      })
      .filter((r) => (wantGrade ? r.grade === wantGrade : true));

    // Targeting: prefer items in the strands the student was weak on. If the
    // student has no diagnostic, or no targeted items exist, fall back to general
    // practice so the tab is never empty.
    const weak = await this.weakProfile(userId);
    let basedOn: 'diagnostic' | 'all' = 'all';
    let weakStrands: string[] = [];
    if (weak && weak.strands.size) {
      weakStrands = [...weak.strands];
      const targeted = shaped.filter((it) => it.strand && weak.strands.has(it.strand));
      if (targeted.length) {
        shaped = targeted;
        basedOn = 'diagnostic';
      }
    }

    // Mastery sequencing: work ONE standard at a time. Pick the student's current
    // target standard (a not-yet-mastered standard, preferring one they've already
    // started), serve ONLY that standard's items, and advance to the next standard
    // only once they reach MASTERY_STREAK correct-in-a-row. An explicit ?standard=
    // overrides the gate for a manual drill.
    let currentStandard: string | null = null;
    let masteryStreak = 0;
    let masteredStandards = 0;
    let remainingStandards = 0;
    if (q.standard) {
      currentStandard = shaped.find((it) => it.standard)?.standard ?? String(q.standard);
      masteryStreak = await this.currentStreak(userId, currentStandard);
    } else {
      const poolStandards = [...new Set(shaped.map((it) => it.standard).filter((v): v is string => !!v))];
      if (poolStandards.length) {
        const progress = await this.standardProgress(userId, poolStandards);
        const unmastered = poolStandards.filter((st) => !progress.get(st)!.mastered);
        masteredStandards = poolStandards.length - unmastered.length;
        remainingStandards = unmastered.length;
        if (unmastered.length) {
          // Keep the student on a standard they've already started (most recent
          // first); otherwise begin the next fresh standard in code order.
          unmastered.sort((a, b) => {
            const pa = progress.get(a)!;
            const pb = progress.get(b)!;
            if (pa.started !== pb.started) return pa.started ? -1 : 1;
            if (pa.started && pb.started) return pb.lastAt - pa.lastAt;
            return a.localeCompare(b);
          });
          currentStandard = unmastered[0];
          masteryStreak = progress.get(currentStandard)!.streak;
        }
      }
    }
    if (currentStandard) {
      shaped = shaped.filter((it) => it.standard === currentStandard);
    }

    // Misconception-driven ordering: within the current standard, float items that
    // probe the student's recent active misconceptions to the front, so practice
    // re-tests the exact errors they've been making.
    const active = await this.activeMisconceptions(userId);
    let focusMisconceptions: string[] = [];
    if (active.size) {
      focusMisconceptions = [...active];
      const probes = (it: { options: { misconceptionTag: string | null }[] }) =>
        it.options.some((o) => o.misconceptionTag && active.has(o.misconceptionTag));
      shaped = [...shaped.filter(probes), ...shaped.filter((it) => !probes(it))];
    }

    return {
      items: shaped.slice(0, take),
      count: Math.min(shaped.length, take),
      basedOn,
      weakStrands,
      focusMisconceptions,
      currentStandard,
      masteryStreak,
      masteryTarget: MASTERY_STREAK,
      masteredStandards,
      remainingStandards,
    };
  }

  /**
   * Per-standard practice progress from the student's answer history. For each
   * standard: the current consecutive-correct streak (newest answers, resets on a
   * miss), whether it's mastered (streak >= MASTERY_STREAK), whether they've
   * started it, and when they last practiced it.
   */
  private async standardProgress(
    userId: string | undefined,
    standards: string[],
  ): Promise<Map<string, { streak: number; mastered: boolean; started: boolean; lastAt: number }>> {
    const map = new Map<string, { streak: number; mastered: boolean; started: boolean; lastAt: number }>();
    for (const st of standards) map.set(st, { streak: 0, mastered: false, started: false, lastAt: 0 });
    if (!userId || !standards.length) return map;
    const rows = await this.prisma.practiceResponse.findMany({
      where: { userId, standard: { in: standards } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    // Newest-first: the leading run of corrects per standard is its current streak.
    const streakClosed = new Set<string>();
    for (const r of rows) {
      const st = r.standard as string | null;
      if (!st) continue;
      const e = map.get(st);
      if (!e) continue;
      if (!e.started) {
        e.started = true;
        e.lastAt = r.createdAt.getTime();
      }
      if (!streakClosed.has(st)) {
        if (r.correct) e.streak += 1;
        else streakClosed.add(st);
      }
    }
    for (const e of map.values()) e.mastered = e.streak >= MASTERY_STREAK;
    return map;
  }

  /** Current consecutive-correct streak on a single standard. */
  private async currentStreak(userId: string | undefined, standard: string): Promise<number> {
    const m = await this.standardProgress(userId, [standard]);
    return m.get(standard)?.streak ?? 0;
  }
}
