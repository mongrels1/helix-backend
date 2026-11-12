import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveToGa } from '../standards/ga-standards';
import { isPlanActive } from '../../common/billing/billing';
import { coveringParent, loadFamilyLinksFor } from '../../common/family/family';
import { productFor } from '../../common/product/product';
import { REACH_BY_PRODUCT } from '../push-map/push-map.tracks';

/** "4", "Grade 4", "4th" → 4. K → 0. Anything else → null. */
function parseGradeText(raw?: string | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  if (s === 'K' || s.startsWith('KINDER')) return 0;
  const m = s.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 && n <= 12 ? n : null;
}

/**
 * Practice climbs through levels, easiest goal first, and moves on only when
 * every standard in a level is mastered (since the latest diagnostic):
 *   gaps  - the diagnostic's weak strands, up to the student's grade;
 *   grade - every strand AT the student's grade, hardest items first;
 *   above - one grade up at a time, as far as the plan reaches
 *           (REACH_BY_PRODUCT: Standard 0, Above-Grade 1, Fellows 2).
 * Before this, a student who mastered the pool hit a dead end: practice kept
 * replaying finished standards and never got harder.
 */
type PracticeLevel = 'gaps' | 'grade' | 'above';

/** Pull the grade number out of a standard or GA cluster code, e.g. "MGSE6.RP.2" -> 6, "6.NR.4" -> 6. */
function gradeOf(s?: string | null): number | null {
  if (!s) return null;
  const g = resolveToGa(String(s));
  const n = g.expectation?.gradeNum ?? g.cluster?.gradeNum ?? null;
  if (n !== null) return n;
  const m = String(s).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve a generated item's diagnostic STRAND (NS/RP/EE/G/SP) from its
 * standard. This is the join key between the diagnostic (which tags weaknesses
 * by strand) and generated items.
 *
 * WAS BROKEN: the regex matched ONLY legacy `MGSE<grade>.<DOMAIN>` codes, so any
 * item carrying a current Georgia code ("6.NR.4.1") resolved to null. A null
 * strand can never match a weak strand, so diagnostic-targeted practice quietly
 * fell back to general practice — the targeting reported `basedOn: 'diagnostic'`
 * nowhere and nobody noticed, because the tab was still full. Every item written
 * by the GA-primary generator would have hit this.
 *
 * Georgia's six strands are folded onto the five strands the DiagnosticSession
 * actually records. Ratio/proportion work is its own diagnostic strand but has
 * no strand of its own in Georgia — it lives in 6.NR.4 and 7.PAR.4 — so those
 * two competencies are routed to RP explicitly.
 */
function strandOfStandard(std?: string | null): string | null {
  const raw = String(std ?? '').trim();
  if (!raw) return null;

  const r = resolveToGa(raw);
  const gaStrand = r.expectation?.strand ?? r.cluster?.strand ?? null;
  const gaCluster = r.cluster?.code ?? null;
  if (gaStrand) {
    if (gaCluster === '6.NR.4' || gaCluster === '7.PAR.4') return 'RP';
    switch (gaStrand) {
      case 'NR': return 'NS';
      case 'PAR': return 'EE';
      case 'FGR': return 'EE';
      case 'GSR': return 'G';
      case 'MDR': return 'SP';
      case 'PR': return 'SP';
      default: break;
    }
  }

  // fall back to the legacy MGSE domain form for anything not yet migrated
  const m = raw.match(/MGSE\d+\.([A-Z]+)/i);
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
  completedAt: Date;
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
    return { strands, kcs, tags, sessionId: session.id, completedAt: session.completedAt };
  }

  /**
   * When the student last finished a diagnostic. Practice "mastered" counts only
   * answers since then: a new diagnostic re-opens the standards it found weak.
   * (Before, a standard mastered once stayed mastered forever, so a student who
   * had worked through the pool kept seeing "everything mastered" even after a
   * new diagnostic at ~50%.)
   */
  private async latestDiagnosticAt(userId?: string): Promise<Date | null> {
    if (!userId) return null;
    const s = await this.prisma.diagnosticSession.findFirst({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    });
    return s?.completedAt ?? null;
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
    const since = standard ? await this.latestDiagnosticAt(userId) : null;
    const masteryStreak = standard ? await this.currentStreak(userId, standard, since) : 0;
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

    // The whole bank (it was the 500 newest only, so older items never reached
    // a student). Capped as a safety net.
    const rows = await this.prisma.draftItem.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: 5000,
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

    const weak = await this.weakProfile(userId);
    const since = weak?.completedAt ?? null;
    const weakStrands: string[] = weak ? [...weak.strands] : [];

    // The student's grade and how far above it their plan reaches. An explicit
    // ?grade= is a manual pick and turns the ladder off.
    const learner = q.grade ? { grade: null, reach: 0 } : await this.learnerLevel(userId);
    const enrolled = learner.grade;
    const gradeCeiling = enrolled !== null ? enrolled + learner.reach : null;
    if (gradeCeiling !== null) {
      const capped = shaped.filter((it) => it.grade === null || it.grade <= gradeCeiling);
      if (capped.length) shaped = capped;
    }

    type Item = (typeof shaped)[number];
    const levels: { key: PracticeLevel; grade: number | null; items: Item[] }[] = [];
    const atOrBelow = (it: Item) => enrolled === null || it.grade === null || it.grade <= enrolled;
    if (weak && weak.strands.size) {
      levels.push({ key: 'gaps', grade: enrolled, items: shaped.filter((it) => atOrBelow(it) && !!it.strand && weak.strands.has(it.strand)) });
    }
    levels.push({ key: 'grade', grade: enrolled, items: enrolled === null ? shaped : shaped.filter((it) => it.grade === null || it.grade === enrolled) });
    if (enrolled !== null) {
      for (let k = 1; k <= learner.reach; k++) {
        levels.push({ key: 'above', grade: enrolled + k, items: shaped.filter((it) => it.grade === enrolled + k) });
      }
    }

    // Mastery sequencing: work ONE standard at a time, in the first level that
    // still has an unmastered standard. Advance only after MASTERY_STREAK
    // correct-in-a-row. An explicit ?standard= overrides the gate for a drill.
    let currentStandard: string | null = null;
    let masteryStreak = 0;
    let masteredStandards = 0;
    let remainingStandards = 0;
    let level: (typeof levels)[number] | null = null;
    const standardsOf = (items: Item[]) => [...new Set(items.map((it) => it.standard).filter((v): v is string => !!v))];
    if (q.standard) {
      currentStandard = shaped.find((it) => it.standard)?.standard ?? String(q.standard);
      masteryStreak = await this.currentStreak(userId, currentStandard, since);
    } else {
      const all = standardsOf(levels.flatMap((l) => l.items));
      const progress = await this.standardProgress(userId, all, since);
      masteredStandards = all.filter((st) => progress.get(st)!.mastered).length;
      for (const l of levels) {
        const unmastered = standardsOf(l.items).filter((st) => !progress.get(st)!.mastered);
        if (!unmastered.length) continue;
        // Keep the student on a standard they've already started (most recent
        // first); otherwise begin the next fresh standard in code order.
        unmastered.sort((a, b) => {
          const pa = progress.get(a)!;
          const pb = progress.get(b)!;
          if (pa.started !== pb.started) return pa.started ? -1 : 1;
          if (pa.started && pb.started) return pb.lastAt - pa.lastAt;
          return a.localeCompare(b);
        });
        level = l;
        currentStandard = unmastered[0];
        masteryStreak = progress.get(currentStandard)!.streak;
        remainingStandards = unmastered.length;
        break;
      }
      // Everything mastered: keep practising the hardest level there is.
      if (!level) level = [...levels].reverse().find((l) => l.items.length) ?? null;
      if (level?.items.length) shaped = level.items;
    }
    if (currentStandard) {
      shaped = shaped.filter((it) => it.standard === currentStandard);
    }
    // Beyond the gaps, harder items first.
    if (level && level.key !== 'gaps') {
      shaped = [...shaped].sort((a, b) => (b.dok ?? 0) - (a.dok ?? 0));
    }
    const basedOn: 'diagnostic' | 'all' = level?.key === 'gaps' ? 'diagnostic' : 'all';

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
      level: level?.key ?? null,
      levelGrade: level?.grade ?? null,
      gradeCeiling,
    };
  }

  /** The student's grade (profile, else latest diagnostic) and their plan's reach above it. */
  private async learnerLevel(userId?: string): Promise<{ grade: number | null; reach: number }> {
    if (!userId) return { grade: null, reach: 0 };
    const u = await this.prisma.user.findFirst({
      where: { id: userId },
      select: {
        role: true, plan: true, planStatus: true, planRenewsAt: true, planSource: true,
        profile: { select: { grade: true } },
      },
    });
    if (!u) return { grade: null, reach: 0 };
    // A scholar's product lives on the parent paying for them (same rule as the
    // Push Map, the ribbon and the admin list).
    const payer = coveringParent(await loadFamilyLinksFor(this.prisma, userId));
    const product = payer
      ? productFor(payer.plan, null, true)
      : productFor(u.plan, u.planSource, isPlanActive(u.planStatus, u.planRenewsAt), u.role);
    let grade = parseGradeText(u.profile?.grade);
    if (grade === null) {
      const d = await this.prisma.diagnosticSession.findFirst({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        select: { grade: true },
      });
      grade = parseGradeText(d?.grade);
    }
    return { grade, reach: REACH_BY_PRODUCT[product.id] ?? 0 };
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
    since: Date | null = null,
  ): Promise<Map<string, { streak: number; mastered: boolean; started: boolean; lastAt: number }>> {
    const map = new Map<string, { streak: number; mastered: boolean; started: boolean; lastAt: number }>();
    for (const st of standards) map.set(st, { streak: 0, mastered: false, started: false, lastAt: 0 });
    if (!userId || !standards.length) return map;
    const rows = await this.prisma.practiceResponse.findMany({
      where: { userId, standard: { in: standards }, ...(since ? { createdAt: { gte: since } } : {}) },
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
  private async currentStreak(userId: string | undefined, standard: string, since: Date | null = null): Promise<number> {
    const m = await this.standardProgress(userId, [standard], since);
    return m.get(standard)?.streak ?? 0;
  }
}
