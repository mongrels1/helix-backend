/**
 * Real-database privacy test: a student (or another class's teacher) cannot
 * reach a classmate's roster entry, help conversations or report.
 * Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomsService } from './classrooms.service';
import { ClassroomsRepository } from './classrooms.repository';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { AITutorService } from '../../intelligence/ai-tutor/ai-tutor.service';
import { AITutorRepository } from '../../intelligence/ai-tutor/ai-tutor.repository';
import { ReportsService } from '../reports/reports.service';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;

run('student privacy (real DB)', () => {
  let prisma: PrismaService;
  let classrooms: ClassroomsService;
  let tutor: AITutorService;
  let reports: ReportsService;
  const sfx = randomUUID().slice(0, 8);
  let classId: string;
  let teacher: { userId: string; role: any };
  let otherTeacher: { userId: string; role: any };
  let ana: { userId: string; role: any };
  let ben: { userId: string; role: any };
  let benSession: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    classrooms = new ClassroomsService(new ClassroomsRepository(prisma), new OrganizationsRepository(prisma), new UsersRepository(prisma));
    tutor = new AITutorService(new AITutorRepository(prisma), { chat: jest.fn() } as any, prisma, { get: () => undefined } as any);
    reports = new ReportsService(prisma, {} as any, { get: () => undefined } as any);
    const org = await prisma.organization.create({ data: { name: `P ${sfx}`, slug: `p-${sfx}` } });
    const mk = async (email: string, role: any) => (await prisma.user.create({ data: { email: `${email}-${sfx}@x.test`, passwordHash: 'x', role, profile: { create: { firstName: email, lastName: 'Z' } } } })).id;
    teacher = { userId: await mk('teach', 'TEACHER'), role: 'TEACHER' };
    otherTeacher = { userId: await mk('other', 'TEACHER'), role: 'TEACHER' };
    ana = { userId: await mk('ana', 'STUDENT'), role: 'STUDENT' };
    ben = { userId: await mk('ben', 'STUDENT'), role: 'STUDENT' };
    classId = (await prisma.classroom.create({ data: { name: 'P6', organizationId: org.id, teacherId: teacher.userId } })).id;
    await prisma.classroom.create({ data: { name: 'Other', organizationId: org.id, teacherId: otherTeacher.userId } });
    for (const s of [ana, ben]) await prisma.enrollment.create({ data: { classroomId: classId, studentId: s.userId } });
    benSession = (await prisma.tutorSession.create({ data: { studentId: ben.userId } })).id;
    await prisma.tutorMessage.create({ data: { sessionId: benSession, role: 'STUDENT', content: "Ben's private question" } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('the class roster (names, emails) is for its teacher only', async () => {
    await expect(classrooms.getEnrollments(classId, ana)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(classrooms.getEnrollments(classId, otherTeacher)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await classrooms.getEnrollments(classId, teacher)).toHaveLength(2);
  });

  it("a student cannot open a classmate's help conversation", async () => {
    await expect(tutor.getSession(benSession, ana.userId, 'STUDENT')).rejects.toBeInstanceOf(ForbiddenException);
    expect((await tutor.getSession(benSession, ben.userId, 'STUDENT')).id).toBe(benSession);
  });

  it("another class's teacher cannot read a student's help conversations; their own teacher can", async () => {
    await expect(tutor.getSession(benSession, otherTeacher.userId, 'TEACHER')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(tutor.getSessionsForStudent(ben.userId, otherTeacher.userId, 'TEACHER')).rejects.toBeInstanceOf(ForbiddenException);
    expect((await tutor.getSession(benSession, teacher.userId, 'TEACHER')).id).toBe(benSession);
    expect(await tutor.getSessionsForStudent(ben.userId, teacher.userId, 'TEACHER')).toHaveLength(1);
  });

  it("a student cannot see a classmate's weekly report (grades, work, time)", async () => {
    await expect(reports.reportForStudent(ana, ben.userId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(reports.reportForStudent(otherTeacher, ben.userId)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await reports.reportForStudent(ben, ben.userId)).studentId).toBe(ben.userId);
  });
});
