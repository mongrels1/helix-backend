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

    return { items: shaped.slice(0, take), count: Math.min(shaped.length, take), basedOn, weakStrands };
  }
}
