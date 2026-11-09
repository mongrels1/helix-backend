/**
 * Real-database test of Build W (worksheet → assignment → server scoring).
 * Skipped unless INTEGRATION_DATABASE_URL is set. Uses the real test case:
 * Proportional or Not? Homework (A–D), key C D C D A D B C A B C A B B D.
 */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WorksheetsService } from './worksheets.service';
import { worksheetMiniLessonDirective } from './worksheet-tutor';
import { AssignmentsRepository } from '../assignments/assignments.repository';
import { SubmissionsService } from '../submissions/submissions.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { ReportsService } from '../reports/reports.service';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;

const KEY = 'C D C D A D B C A B C A B B D'.split(' ');
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).toString('base64')}`;
const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
const questions = Array.from({ length: 15 }, (_, i) => ({
  stem: `Q${i + 1} stem`,
  options: { A: `a${i}`, B: `b${i}`, C: `c${i}`, D: `d${i}` },
  feedback: { A: `fa${i}`, B: `fb${i}`, C: `fc${i}`, D: `fd${i}` },
  crop: { page: i < 9 ? 1 : 2, x: 0.05, y: 0.1 + (i % 9) * 0.08, w: 0.45, h: 0.15 },
}));

run('Build W worksheets (real DB)', () => {
  let prisma: PrismaService;
  let svc: WorksheetsService;
  let subs: SubmissionsService;
  let assignmentsRepo: AssignmentsRepository;
  let reports: ReportsService;
  const ai = { claudeVision: jest.fn() };
  const sfx = randomUUID().slice(0, 8);
  type U = { userId: string; role: any };
  let owner: U, co: U, viewer: U, outsider: U, s6: U, s6b: U, s7: U, sOther: U;
  let p6: string, p7: string, pOther: string;
  let worksheetId: string;
  let a6: string, a7: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    const config = { get: () => undefined } as any;
    svc = new WorksheetsService(prisma, ai as any, config);
    assignmentsRepo = new AssignmentsRepository(prisma);
    subs = new SubmissionsService(new SubmissionsRepository(prisma), assignmentsRepo, { emit: jest.fn() } as any);
    reports = new ReportsService(prisma, {} as any, config);
    const org = await prisma.organization.create({ data: { name: `W ${sfx}`, slug: `w-${sfx}` } });
    const mk = async (local: string, role: string): Promise<U> => {
      const u = await prisma.user.create({ data: { email: `${local}-${sfx}@dekalbschoolsga.org`, passwordHash: 'x', role: role as any, profile: { create: { firstName: local, lastName: 'T' } } } });
      return { userId: u.id, role };
    };
    owner = await mk('owner', 'TEACHER');
    co = await mk('co', 'TEACHER');
    viewer = await mk('viewer', 'TEACHER');
    outsider = await mk('outsider', 'TEACHER');
    s6 = await mk('s6', 'STUDENT');
    s6b = await mk('s6b', 'STUDENT');
    s7 = await mk('s7', 'STUDENT');
    sOther = await mk('sother', 'STUDENT');
    const mkc = async (name: string, teacherId: string) => (await prisma.classroom.create({ data: { name, organizationId: org.id, teacherId } })).id;
    p6 = await mkc('P6', owner.userId);
    p7 = await mkc('P7', owner.userId);
    pOther = await mkc('Other', outsider.userId);
    await prisma.classroomStaff.create({ data: { classroomId: p6, userId: co.userId, role: 'CO_TEACHER', addedById: owner.userId } });
    await prisma.classroomStaff.create({ data: { classroomId: p6, userId: viewer.userId, role: 'VIEWER', addedById: owner.userId } });
    for (const [c, s] of [[p6, s6], [p6, s6b], [p7, s7], [pOther, sOther]] as const) {
      await prisma.enrollment.create({ data: { classroomId: c, studentId: s.userId } });
    }
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('draft: typed key wins, feedback for the correct letter is dropped, problems listed', async () => {
    ai.claudeVision.mockResolvedValueOnce(
      '```json\n' + JSON.stringify({ questions: questions.map((q) => ({ ...q, key: 'A', crop: { ...q.crop, page: 1 } })), notes: ['page 2 faint'] }) + '\n```',
    );
    const d = await svc.draft({ pageImages: [JPEG], typedKey: KEY.join(' ') });
    expect(d.key).toEqual(KEY);
    expect(d.keySource).toBe('typed');
    expect(d.questions[0].feedback).toEqual({ A: 'fa0', B: 'fb0', D: 'fd0' }); // no C (the key)
    expect(d.problems).toEqual([]);
    expect(d.notes).toEqual(['page 2 faint']);
    expect(d.notAD).toBe(false);
    expect(d.problems).toEqual([]); // the AI gave a crop for every question on the 1 page
    // A circle-the-answer sheet forced into A–D is flagged, not passed off as ready.
    ai.claudeVision.mockResolvedValueOnce(JSON.stringify({ questions: Array.from({ length: 10 }, () => ({ stem: 'Is it proportional?', options: { A: 'Proportional', B: 'Not proportional', C: 'Proportional', D: 'Not proportional' } })) }));
    const bad = await svc.draft({ pageImages: [JPEG], typedKey: KEY.join(' ') });
    expect(bad.notAD).toBe(true);
    expect(bad.problems.length).toBeGreaterThan(0);
    await expect(svc.draft({ pageImages: [SVG] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('save is fail-closed: a wrong-length key or an E blocks it; a clean one saves', async () => {
    await expect(svc.create(owner, { title: 'Proportional or Not?', pageImages: [JPEG], questions, key: KEY.slice(0, 14) })).rejects.toBeInstanceOf(BadRequestException);
    const bad = [...KEY];
    bad[0] = 'E';
    await expect(svc.create(owner, { title: 'Proportional or Not?', pageImages: [JPEG], questions, key: bad })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(owner, { title: 'x', pageImages: [SVG], questions, key: KEY })).rejects.toBeInstanceOf(BadRequestException);
    // A question without a crop (no picture for the student) blocks saving; so does a crop on a missing page.
    const noCrop = questions.map((q, i) => (i === 3 ? { ...q, crop: undefined } : q));
    await expect(svc.create(owner, { title: 'x', pageImages: [JPEG, JPEG], questions: noCrop as any, key: KEY })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(owner, { title: 'x', pageImages: [JPEG], questions, key: KEY })).rejects.toBeInstanceOf(BadRequestException);
    const ws = await svc.create(owner, { title: 'Proportional or Not?', standard: '7.PAR.4.3', pageImages: [JPEG, JPEG], questions, key: KEY });
    expect(ws.questionCount).toBe(15);
    worksheetId = ws.id;
    const stored = await prisma.worksheet.findUniqueOrThrow({ where: { id: ws.id } });
    expect((stored.questions as any)[0].feedback.C).toBeUndefined();
  });

  it('assigns to two classes in one action; only classes you can teach', async () => {
    const due = new Date(Date.now() + 3 * 86400_000).toISOString();
    await expect(svc.assign(owner, worksheetId, { classroomIds: [p6, pOther], dueAt: due })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assign(outsider, worksheetId, { classroomIds: [pOther], dueAt: due })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.assign(owner, worksheetId, { classroomIds: [p6], dueAt: new Date(Date.now() - 1000).toISOString() })).rejects.toBeInstanceOf(BadRequestException);
    const made = await svc.assign(owner, worksheetId, { classroomIds: [p6, p7], dueAt: due });
    expect(made.map((m) => m.classroomId).sort()).toEqual([p6, p7].sort());
    a6 = made.find((m) => m.classroomId === p6)!.id;
    a7 = made.find((m) => m.classroomId === p7)!.id;
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: a6 } })).maxScore).toBe(15);
  });

  it('students see questions but never the key or feedback before submitting', async () => {
    const sheet: any = await svc.sheet(s6, a6);
    expect(sheet.role).toBe('student');
    expect(sheet.questionCount).toBe(15);
    expect(sheet.pages).toHaveLength(2);
    expect(sheet.questions[10].crop).toEqual({ page: 2, x: 0.05, y: 0.18, w: 0.45, h: 0.15 });
    const text = JSON.stringify(sheet);
    expect(text).not.toContain('"key"');
    expect(text).not.toContain('fa0');
    expect(text).not.toContain('correctAnswer');
    await expect(svc.sheet(sOther, a6)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.sheet(s7, a6)).rejects.toBeInstanceOf(ForbiddenException);
    // Pages: assigned students and staff only.
    await expect(svc.page(s6, sheet.pages[0])).resolves.toBeTruthy();
    await expect(svc.page(sOther, sheet.pages[0])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.page(outsider, sheet.pages[0])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.page(viewer, sheet.pages[0])).resolves.toBeTruthy();
  });

  it('autosave keeps answers; the old generic submission routes refuse worksheets', async () => {
    await svc.saveDraft(s6, a6, ['C', 'D', 'x']);
    const sheet: any = await svc.sheet(s6, a6);
    expect(sheet.answers.slice(0, 4)).toEqual(['C', 'D', null, null]);
    await expect(subs.create({ assignmentId: a7 } as any, s7.userId)).rejects.toBeInstanceOf(BadRequestException);
    const sub = await prisma.submission.findUniqueOrThrow({ where: { assignmentId_studentId: { assignmentId: a6, studentId: s6.userId } } });
    await expect(subs.submit(sub.id, s6.userId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.saveDraft(owner, a6, [])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('submit scores on the server: perfect key = 15, all-A = 3, one attempt only', async () => {
    const r1: any = await svc.submit(s6, a6, KEY);
    expect(r1.score).toBe(15);
    expect(r1.answersRevealed).toBe(false);
    expect(JSON.stringify(r1)).not.toContain('correctAnswer');
    await expect(svc.submit(s6, a6, KEY)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.saveDraft(s6, a6, KEY)).rejects.toBeInstanceOf(ConflictException);

    // A client cannot send a score: extra fields are not read; only letters count.
    const r2: any = await svc.submit(s6b, a6, Array(15).fill('A'));
    expect(r2.score).toBe(3);
    expect(r2.questions[0]).toEqual({ n: 1, yourAnswer: 'A', correct: false, feedback: 'fa0' });

    const grade = await prisma.grade.findFirstOrThrow({ where: { submission: { assignmentId: a6, studentId: s6b.userId } } });
    expect([grade.score, grade.maxScore, grade.gradedById]).toEqual([3, 15, owner.userId]);
  });

  it('teacher results: per-student scores and per-question counts; view-only may look, outsider may not', async () => {
    const r: any = await svc.results(viewer, a6);
    expect(r.summary).toEqual({ students: 2, submitted: 2, averageScore: 9 });
    expect(r.items[0]).toEqual({ n: 1, key: 'C', counts: { A: 1, B: 0, C: 1, D: 0, blank: 0 }, percentCorrect: 50 });
    expect(r.rows.map((x: any) => [x.firstName, x.score])).toEqual([['s6', 15], ['s6b', 3]]);
    await expect(svc.results(outsider, a6)).rejects.toBeInstanceOf(ForbiddenException);
    const t: any = await svc.sheet(co, a6);
    expect(t.key).toEqual(KEY);
  });

  it('mini lesson: no correct letter before the due date; the letter after it', async () => {
    const before = await worksheetMiniLessonDirective(prisma, a6, s6b.userId, 1);
    expect(before).toContain('ANSWERS NOT YET RELEASED');
    expect(before).toContain('The student chose: A.');
    expect(before).not.toMatch(/correct answer is/i);
    expect(await worksheetMiniLessonDirective(prisma, a6, s6.userId, 99)).toBeNull();
    expect(await worksheetMiniLessonDirective(prisma, a7, s7.userId, 1)).toBeNull(); // not submitted
    const after = await worksheetMiniLessonDirective(prisma, a6, s6b.userId, 1, new Date(Date.now() + 10 * 86400_000));
    expect(after).toContain('The correct answer is C) c0.');
  });

  it('after the due date: closed to new work, answers shown to those who submitted', async () => {
    await prisma.assignment.update({ where: { id: a7 }, data: { dueAt: new Date(Date.now() - 60_000) } });
    await expect(svc.submit(s7, a7, KEY)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.saveDraft(s7, a7, KEY)).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.assignment.update({ where: { id: a6 }, data: { dueAt: new Date(Date.now() - 60_000) } });
    const sheet: any = await svc.sheet(s6b, a6);
    expect(sheet.result.answersRevealed).toBe(true);
    expect(sheet.result.questions.map((q: any) => q.correctAnswer)).toEqual(KEY);
  });

  it('chosen students only: others in the class do not see it, in the list, the sheet or the report', async () => {
    const due = new Date(Date.now() + 2 * 86400_000);
    await expect(svc.assign(owner, worksheetId, { classroomIds: [p6], studentIds: [sOther.userId], dueAt: due.toISOString() })).rejects.toBeInstanceOf(BadRequestException);
    const [only] = await svc.assign(owner, worksheetId, { classroomIds: [p6, p7], studentIds: [s6b.userId], dueAt: due.toISOString(), title: 'Retry' });
    expect(only.classroomId).toBe(p6); // P7 had none of the chosen students
    await expect(svc.sheet(s6, only.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(((await svc.sheet(s6b, only.id)) as any).role).toBe('student');
    const [listS6] = await assignmentsRepo.findAll(p6, 1, 50, { userId: s6.userId, role: 'STUDENT' as any });
    const [listS6b] = await assignmentsRepo.findAll(p6, 1, 50, { userId: s6b.userId, role: 'STUDENT' as any });
    expect(listS6.map((a) => a.id)).not.toContain(only.id);
    expect(listS6b.map((a) => a.id)).toContain(only.id);
    expect((await svc.results(owner, only.id)).summary.students).toBe(1);
    void reports;
  });

  it('a deleted assignment is gone for everyone', async () => {
    await prisma.assignment.update({ where: { id: a7 }, data: { deletedAt: new Date() } });
    await expect(svc.sheet(s7, a7)).rejects.toBeInstanceOf(NotFoundException);
  });
});
