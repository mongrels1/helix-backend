import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Pull the grade number out of a standard or GA cluster code, e.g. "MGSE6.RP.2" -> 6, "6.NR.4" -> 6. */
function gradeOf(s?: string | null): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

type RawOption = { text?: string; correct?: boolean; misconceptionTag?: string };

/**
 * Practice pool. Serves APPROVED generated items (field_test + operational) to
 * students as UNSCORED practice. This is the automatic bridge: the moment an
 * item is approved in the Question Generator it appears here — no per-batch work.
 *
 * NOTE: practice is intentionally separate from the scored adaptive diagnostic.
 * Uncalibrated items never touch the diagnostic ruler; they only earn their way
 * in later via the field-test/calibration pipeline.
 */
@Injectable()
export class PracticeService {
  constructor(private readonly prisma: PrismaService) {}

  async items(q: { grade?: string; standard?: string; limit?: string }) {
    const take = Math.min(Math.max(Number(q.limit) || 20, 1), 100);

    const where: { status: { in: ('field_test' | 'operational')[] }; standard?: { contains: string } } = {
      status: { in: ['field_test', 'operational'] },
    };
    if (q.standard) where.standard = { contains: String(q.standard) };

    const rows = await this.prisma.draftItem.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const wantGrade = q.grade ? Number(q.grade) : null;

    const shaped = rows
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
          grade: gradeOf(r.standard) ?? gradeOf(r.gaCluster),
          skillTags: r.skillTags ?? [],
          dok: r.dok,
          difficulty: r.difficulty,
          solution: r.solution,
          status: r.status,
        };
      })
      .filter((r) => (wantGrade ? r.grade === wantGrade : true))
      .slice(0, take);

    return { items: shaped, count: shaped.length };
  }
}
