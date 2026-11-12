import { PracticeService } from './practice.service';

/**
 * Practice after a new diagnostic, and what happens once a student has
 * mastered everything: it climbs (gaps -> every strand at grade -> above grade
 * as far as the plan reaches) instead of replaying finished work.
 */
describe('PracticeService levels', () => {
  const diagAt = new Date('2026-11-11T23:00:00Z');
  const after = new Date('2026-11-11T23:30:00Z');
  const before = new Date('2026-11-01T12:00:00Z');
  const item = (id: string, standard: string, dok = 1) => ({
    id, stem: `${id}?`, figure: null, standard, gaCluster: null, skillTags: [], dok, difficulty: 'medium', solution: '', status: 'draft',
    options: [{ text: 'a', correct: true }, { text: 'b', correct: false, misconceptionTag: 'm' }],
  });
  const fourRight = (standard: string, at: Date) =>
    Array.from({ length: 4 }, () => ({ standard, correct: true, createdAt: at, misconceptionTag: null }));

  function make(opts: {
    items: ReturnType<typeof item>[];
    weakStrand: string;
    grade: string | null;
    parentPlan: string | null;
    answers?: { standard: string; correct: boolean; createdAt: Date; misconceptionTag: null }[];
  }) {
    const answers = opts.answers ?? [];
    const practiceFind = jest.fn(async (args: any) => {
      const w = args.where;
      if (!w.standard) return [];
      return answers
        .filter((a) => w.standard.in.includes(a.standard))
        .filter((a) => !w.createdAt || a.createdAt >= w.createdAt.gte);
    });
    const parent = opts.parentPlan
      ? [{ studentId: 'u1', parent: {
          id: 'p1', email: 'p@example.com', role: 'PARENT', plan: opts.parentPlan, planStatus: 'active',
          planRenewsAt: new Date('2030-01-01'), deletedAt: null, profile: { firstName: 'P', lastName: 'S' },
        } }]
      : [];
    const prisma = {
      draftItem: { findMany: jest.fn().mockResolvedValue(opts.items) },
      diagnosticSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'd2', completedAt: diagAt, grade: null,
          responses: [{ correct: false, strand: opts.weakStrand, kc: 'k', tag: 'not-yet' }],
        }),
      },
      practiceResponse: { findMany: practiceFind },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          role: 'STUDENT', plan: null, planStatus: null, planRenewsAt: null, planSource: null,
          profile: { grade: opts.grade },
        }),
      },
      parentStudentLink: { findMany: jest.fn(async (a: any) => (a.where.studentId ? parent : [])) },
    };
    return { svc: new PracticeService(prisma as any), practiceFind };
  }

  it('a new diagnostic re-opens practice: history counts only since the diagnostic', async () => {
    const { svc, practiceFind } = make({
      items: [item('i1', '6.NR.4.1'), item('i2', '6.NR.4.2')],
      weakStrand: 'RP', grade: '6', parentPlan: 'EdKairos Standard',
      answers: [...fourRight('6.NR.4.1', before), ...fourRight('6.NR.4.2', before)],
    });
    const r = await svc.items('u1', {});
    const progressCall = practiceFind.mock.calls.find((c) => (c[0] as any).where.standard) as any;
    expect(progressCall[0].where.createdAt).toEqual({ gte: diagAt });
    expect(r.level).toBe('gaps');
    expect(r.basedOn).toBe('diagnostic');
    expect(r.masteredStandards).toBe(0);
    expect(r.currentStandard).toBe('6.NR.4.1');
  });

  const ladder = [
    item('g4a', '4.NR.1.1', 1), item('g4b', '4.NR.2.1', 3),
    item('g5a', '5.NR.1.1', 1), item('g5b', '5.NR.1.1', 3),
    item('g6a', '6.NR.1.1', 2),
  ];
  const masteredGrade4 = [...fourRight('4.NR.1.1', after), ...fourRight('4.NR.2.1', after)];

  it('Above-Grade: once grade 4 is mastered, practice moves to grade 5 (not 6), hardest first', async () => {
    const { svc } = make({ items: ladder, weakStrand: 'G', grade: '4', parentPlan: 'EdKairos Above-Grade', answers: masteredGrade4 });
    const r = await svc.items('u1', {});
    expect(r.gradeCeiling).toBe(5);
    expect(r.level).toBe('above');
    expect(r.levelGrade).toBe(5);
    expect(r.currentStandard).toBe('5.NR.1.1');
    expect(r.items.map((i) => i.id)).toEqual(['g5b', 'g5a']);
    expect(r.masteredStandards).toBe(2);
  });

  it('Standard: stays at grade, hardest items first, never above grade', async () => {
    const { svc } = make({ items: ladder, weakStrand: 'G', grade: '4', parentPlan: 'EdKairos Standard', answers: masteredGrade4 });
    const r = await svc.items('u1', {});
    expect(r.gradeCeiling).toBe(4);
    expect(r.level).toBe('grade');
    expect(r.items.every((i) => i.grade === 4)).toBe(true);
    expect(r.items[0].id).toBe('g4b');
  });

  it('before grade 4 is mastered, an Above-Grade student still works at grade 4 first', async () => {
    const { svc } = make({ items: ladder, weakStrand: 'G', grade: '4', parentPlan: 'EdKairos Above-Grade', answers: fourRight('4.NR.1.1', after) });
    const r = await svc.items('u1', {});
    expect(r.level).toBe('grade');
    expect(r.currentStandard).toBe('4.NR.2.1');
  });
});
