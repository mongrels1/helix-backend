/**
 * Real-database test of the weekly report: the one builder behind the parent
 * email, the teacher's student page, printouts and the student's counter.
 * Skipped unless INTEGRATION_DATABASE_URL points at a throwaway Postgres.
 */
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';
import { schoolWeek } from './report-week';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;

run('weekly report (real DB)', () => {
  let prisma: PrismaService;
  let svc: ReportsService;
  const sfx = randomUUID().slice(0, 8);
  const WEEK = '2026-11-09'; // Mon 9 – Sun 15 Nov 2026
  let teacher: { userId: string; role: any };
  let other: { userId: string; role: any };
  let classroomId: string;
  let kaylis: string;
  let jay: string;

  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const et = (d: string, hh: number) => new Date(Date.parse(`${d}T00:00:00.000Z`) + (hh + 5) * 3600_000); // EST

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new ReportsService(prisma, { sendEmail: jest.fn() } as any, { get: () => undefined } as any);
    const org = await prisma.organization.create({ data: { name: `R ${sfx}`, slug: `r-${sfx}` } });
    const t = await prisma.user.create({ data: { email: `t-${sfx}@x.test`, passwordHash: 'x', role: 'TEACHER' } });
    const o = await prisma.user.create({ data: { email: `o-${sfx}@x.test`, passwordHash: 'x', role: 'TEACHER' } });
    teacher = { userId: t.id, role: 'TEACHER' };
    other = { userId: o.id, role: 'TEACHER' };
    classroomId = (await prisma.classroom.create({ data: { name: 'Math 7 · Period 4', organizationId: org.id, teacherId: t.id } })).id;
    const mk = async (f: string, l: string) => (await prisma.user.create({
      data: { email: `${f}-${sfx}@x.invalid`, passwordHash: 'x', role: 'STUDENT', profile: { create: { firstName: f, lastName: l } },
        enrollments: { create: { classroomId } } },
    })).id;
    kaylis = await mk('Kaylis', 'Baker');
    jay = await mk('Jay', 'Brown');

    // Kaylis: 70 min Mon, 50 min Wed, 80 min Sun = 200 min. Plus last Sunday (outside) and next Monday (outside).
    for (const [d, sec] of [['2026-11-09', 4200], ['2026-11-11', 3000], ['2026-11-15', 4800], ['2026-11-08', 9999], ['2026-11-16', 9999]] as const) {
      await prisma.presenceDay.create({ data: { studentId: kaylis, date: day(d), firstSeenAt: et(d, 16), lastSeenAt: et(d, 17), activeSeconds: sec } });
    }
    await prisma.loginEvent.create({ data: { userId: kaylis, loginAt: et('2026-11-09', 16) } });
    await prisma.loginEvent.create({ data: { userId: kaylis, loginAt: et('2026-11-11', 16) } });
    const session = await prisma.tutorSession.create({ data: { studentId: kaylis, createdAt: et('2026-11-11', 16) } });
    await prisma.tutorMessage.create({ data: { sessionId: session.id, role: 'STUDENT', content: "I don't get #4", createdAt: et('2026-11-11', 16) } });
    await prisma.tutorMessage.create({ data: { sessionId: session.id, role: 'TUTOR', content: 'What do you notice?', createdAt: et('2026-11-11', 16) } });
    // Sunday 11:30 pm ET is still this week (UTC already Monday).
    await prisma.tutorMessage.create({ data: { sessionId: session.id, role: 'STUDENT', content: 'late question', createdAt: new Date('2026-11-16T04:30:00Z') } });
    const due = await prisma.assignment.create({ data: { title: 'Unit rates HW', classroomId, dueAt: et('2026-11-12', 23), maxScore: 10 } });
    await prisma.assignment.create({ data: { title: 'Next week HW', classroomId, dueAt: et('2026-11-18', 23) } });
    const sub = await prisma.submission.create({ data: { assignmentId: due.id, studentId: kaylis, status: 'SUBMITTED', submittedAt: et('2026-11-12', 18) } });
    await prisma.grade.create({ data: { submissionId: sub.id, score: 8, maxScore: 10, gradedById: t.id } });
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it('lists the work completed by day and flags lots of time with little work (teacher only)', async () => {
    const r1 = await svc.buildStudentReport(kaylis, { week: WEEK });
    // 200 min but only 3 pieces of work (1 turned in + 2 help questions) → 0.9 per hour → flagged.
    expect(r1.work).toEqual(expect.objectContaining({ items: 3, assignmentsTurnedIn: 1, helpQuestions: 2, practiceAnswered: 0, lowOutput: true }));
    expect(r1.work.log).toEqual([
      { date: '2026-11-11', kind: 'help', count: 1 },
      { date: '2026-11-12', kind: 'assignment', title: 'Unit rates HW', score: 8, maxScore: 10 },
      { date: '2026-11-15', kind: 'help', count: 1 }, // Sunday 11:30 pm ET stays on Sunday
    ]);
    // Families never see the flag.
    expect((await svc.reportForStudent({ userId: kaylis, role: 'STUDENT' }, kaylis, WEEK)).work.lowOutput).toBe(false);

    // 12 practice answers on two standards on Wednesday → grouped, and no longer flagged (15 items / 3.3 h).
    for (let i = 0; i < 12; i++) {
      await prisma.practiceResponse.create({ data: { userId: kaylis, draftItemId: randomUUID(), standard: i < 8 ? '7.RP.A.2' : '7.NS.A.1', pickedIndex: 0, correct: i % 3 !== 0, createdAt: et('2026-11-11', 17) } });
    }
    const r2 = await svc.buildStudentReport(kaylis, { week: WEEK });
    expect(r2.work.items).toBe(15);
    expect(r2.work.lowOutput).toBe(false);
    expect(r2.work.log.filter((e) => e.kind === 'practice')).toEqual([
      { date: '2026-11-11', kind: 'practice', standard: '7.RP.A.2', count: 8, correct: 5 },
      { date: '2026-11-11', kind: 'practice', standard: '7.NS.A.1', count: 4, correct: 3 },
    ]);
    expect(svc.renderHtml([r2], 'Ms Baker')).toContain('1 assignment(s) turned in &middot; 12 practice question(s) &middot; 2 help question(s)');
  });

  it("counts measured minutes Mon–Sun school time only, with the daily breakdown", async () => {
    const r = await svc.buildStudentReport(kaylis, { week: '2026-11-12' });
    expect(r.week).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(r.timeOnApp.minutes).toBe(200);
    expect(r.timeOnApp.activeDays).toBe(3);
    expect(r.timeOnApp.sessions).toBe(2);
    expect(r.daily.map((d) => d.minutes)).toEqual([70, 0, 50, 0, 0, 0, 80]);
    expect(r.goal).toEqual({ minutes: 180, pct: 100, band: 'met' });
    expect(r.fullName).toBe('Kaylis Baker');
    expect(r.classrooms.map((c) => c.name)).toEqual(['Math 7 · Period 4']);
  });

  it('includes help questions (students only) and the week’s assignments with scores', async () => {
    const r = await svc.buildStudentReport(kaylis, { week: WEEK });
    expect(r.help.questions).toBe(2);
    expect(r.help.recent).toEqual(['late question', "I don't get #4"]);
    expect(r.assignments).toEqual([
      expect.objectContaining({ title: 'Unit rates HW', score: 8, maxScore: 10 }),
    ]);
  });

  it('marks a student who never signed in as "none" and one with too little as "low"', async () => {
    const r = await svc.buildStudentReport(jay, { week: WEEK });
    expect(r.timeOnApp.minutes).toBe(0);
    expect(r.goal.band).toBe('none');
    expect(r.assignments[0]).toEqual(expect.objectContaining({ title: 'Unit rates HW', submittedAt: null }));
  });

  it("uses the class's goal everywhere once set", async () => {
    await svc.setClassroomGoal(teacher, classroomId, 240);
    const cls = await svc.reportsForClassroom(teacher, classroomId, WEEK);
    expect(cls.classroom).toEqual(expect.objectContaining({ goalMinutes: 240, goalIsDefault: false }));
    expect(cls.reports.map((x) => x.fullName)).toEqual(['Jay Brown', 'Kaylis Baker']);
    const k = cls.reports.find((x) => x.studentId === kaylis)!;
    expect(k.goal).toEqual({ minutes: 240, pct: 83, band: 'partway' });
    // The single-student report (no class given) picks the same goal from the student's class.
    expect((await svc.buildStudentReport(kaylis, { week: WEEK })).goal.minutes).toBe(240);
    await svc.setClassroomGoal(teacher, classroomId, null);
    expect((await svc.reportsForClassroom(teacher, classroomId, WEEK)).classroom.goalMinutes).toBe(180);
  });

  it('only lets the right people see a report', async () => {
    await expect(svc.reportForStudent(teacher, kaylis, WEEK)).resolves.toBeTruthy();
    await expect(svc.reportForStudent(other, kaylis, WEEK)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reportsForClassroom(other, classroomId, WEEK)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reportForStudent({ userId: jay, role: 'STUDENT' }, kaylis, WEEK)).rejects.toBeInstanceOf(ForbiddenException);
    const self = await svc.reportForStudent({ userId: kaylis, role: 'STUDENT' }, kaylis, WEEK);
    expect(self.help.recent).toEqual([]); // question text is for the teacher only
    await expect(svc.setClassroomGoal(other, classroomId, 200)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the parent email shows the same practice minutes and goal', async () => {
    const r = await svc.buildStudentReport(kaylis, { schoolWeek: schoolWeek(WEEK) });
    const html = svc.renderHtml([r], 'Ms Baker');
    expect(html).toContain('Practice time');
    expect(html).toContain('3h 20m</strong> of the 3h 0m weekly goal');
    expect(html).not.toMatch(/\bAI\b/);
    expect(html).not.toContain("I don't get #4");
  });
});
