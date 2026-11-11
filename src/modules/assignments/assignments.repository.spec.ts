import { Role, SubmissionStatus } from '@prisma/client';
import { AssignmentsRepository, withOwnSubmission } from './assignments.repository';

/**
 * Students' assignment list must carry their own turn-in status. Before this,
 * a worksheet turned in (and confirmed) still showed as "To do" and never
 * reached "Submitted" on the student's screen.
 */
describe('AssignmentsRepository.findAll (student turn-in status)', () => {
  const row = (id: string, submissions?: { status: SubmissionStatus; submittedAt: Date | null }[]) => ({
    id, title: id, classroomId: 'c1', worksheetId: 'w1', rubric: null, ...(submissions ? { submissions } : {}),
  });

  function repoWith(rows: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const count = jest.fn().mockResolvedValue(rows.length);
    const prisma = {
      assignment: { findMany, count },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { repo: new AssignmentsRepository(prisma as any), findMany };
  }

  it('a student gets submissionStatus/submittedAt for their own work only', async () => {
    const when = new Date('2026-11-10T23:00:00Z');
    const { repo, findMany } = repoWith([
      row('turned-in', [{ status: SubmissionStatus.GRADED, submittedAt: when }]),
      row('started', [{ status: SubmissionStatus.DRAFT, submittedAt: null }]),
      row('untouched', []),
    ]);
    const [list] = await repo.findAll(undefined, 1, 20, { userId: 's1', role: Role.STUDENT });

    const include = findMany.mock.calls[0][0].include;
    expect(include.submissions.where).toEqual({ studentId: 's1' });
    expect(include.submissions.select).toEqual({ status: true, submittedAt: true });

    expect(list.map((a) => [a.id, a.submissionStatus, a.submittedAt])).toEqual([
      ['turned-in', 'GRADED', when],
      ['started', 'DRAFT', null],
      ['untouched', null, null],
    ]);
    expect(list.every((a) => !('submissions' in a))).toBe(true);
  });

  it('a teacher list is unchanged (no submissions joined)', async () => {
    const { repo, findMany } = repoWith([row('a')]);
    const [list] = await repo.findAll('c1', 1, 20, { userId: 't1', role: Role.TEACHER });
    expect(findMany.mock.calls[0][0].include.submissions).toBeUndefined();
    expect(list[0]).not.toHaveProperty('submissionStatus');
  });

  it('withOwnSubmission never copies answers or other fields from the submission', () => {
    const out = withOwnSubmission({ id: 'x', submissions: [{ status: SubmissionStatus.SUBMITTED, submittedAt: null, content: 'secret' } as any] });
    expect(out).toEqual({ id: 'x', submissionStatus: 'SUBMITTED', submittedAt: null });
  });
});
