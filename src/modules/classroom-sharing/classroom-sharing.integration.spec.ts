/**
 * Real-database test of sharing a class. Skipped unless INTEGRATION_DATABASE_URL
 * is set. Covers: district-email-only invites, the link working only for the
 * invited address, co-teacher vs view-only rights across modules, removal, and
 * that nobody else gains anything.
 */
import { BadRequestException, ForbiddenException, GoneException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassroomSharingService } from './classroom-sharing.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { ClassroomsRepository } from '../classrooms/classrooms.repository';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { ReportsService } from '../reports/reports.service';
import { ClassPassService } from '../class-pass/class-pass.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { AssignmentsRepository } from '../assignments/assignments.repository';
import { CoursesRepository } from '../courses/courses.repository';
import { AITutorService } from '../../intelligence/ai-tutor/ai-tutor.service';
import { AITutorRepository } from '../../intelligence/ai-tutor/ai-tutor.repository';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;
const tokenOf = (link: string) => link.split('/join-class/')[1];

run('sharing a class (real DB)', () => {
  let prisma: PrismaService;
  let sharing: ClassroomSharingService;
  let classrooms: ClassroomsService;
  let reports: ReportsService;
  let classPass: ClassPassService;
  let assignments: AssignmentsService;
  let tutor: AITutorService;
  const sent: { to: string; link: string }[] = [];
  const sfx = randomUUID().slice(0, 8);
  type U = { userId: string; role: any; email: string };
  let owner: U, co: U, viewer: U, outsider: U, gmail: U, student: U;
  let p6: string, p7: string, p4: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    const config = { get: (k: string) => (k === 'app.frontendUrl' ? 'https://app.test' : undefined) } as any;
    const email = { sendClassInvite: jest.fn(async (to: string, m: { link: string }) => { sent.push({ to, link: m.link }); }) } as any;
    sharing = new ClassroomSharingService(prisma, email, config);
    const classroomsRepo = new ClassroomsRepository(prisma);
    classrooms = new ClassroomsService(classroomsRepo, new OrganizationsRepository(prisma), new UsersRepository(prisma));
    reports = new ReportsService(prisma, {} as any, config);
    classPass = new ClassPassService(prisma, config, { issueSessionFor: jest.fn() } as any);
    assignments = new AssignmentsService(new AssignmentsRepository(prisma), classroomsRepo, new CoursesRepository(prisma));
    tutor = new AITutorService(new AITutorRepository(prisma), { chat: jest.fn() } as any, prisma, config);
    const org = await prisma.organization.create({ data: { name: `S ${sfx}`, slug: `s-${sfx}`, rosterEnabled: true } });
    const mk = async (local: string, role: string, domain = 'dekalbschoolsga.org'): Promise<U> => {
      const em = `${local}-${sfx}@${domain}`;
      const u = await prisma.user.create({ data: { email: em, passwordHash: 'x', role: role as any, profile: { create: { firstName: local, lastName: 'T' } } } });
      return { userId: u.id, role, email: em };
    };
    owner = await mk('owner', 'TEACHER');
    co = await mk('co', 'TEACHER');
    viewer = await mk('view', 'TEACHER');
    outsider = await mk('out', 'TEACHER');
    gmail = await mk('gm', 'TEACHER', 'gmail.com');
    student = await mk('stu', 'STUDENT');
    const mkc = async (name: string) => (await prisma.classroom.create({ data: { name, organizationId: org.id, teacherId: owner.userId, classPassOn: true, classPassCode: randomUUID().slice(0, 6).toUpperCase() } })).id;
    p6 = await mkc('P6'); p7 = await mkc('P7'); p4 = await mkc('P4');
    await prisma.enrollment.create({ data: { classroomId: p6, studentId: student.userId } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('invites only district staff addresses, and only for classes you own', async () => {
    await expect(sharing.invite(owner, `x-${sfx}@gmail.com`, 'CO_TEACHER', [p6])).rejects.toBeInstanceOf(BadRequestException);
    await expect(sharing.invite(owner, `x+alias-${sfx}@dekalbschoolsga.org`, 'CO_TEACHER', [p6])).rejects.toBeInstanceOf(BadRequestException);
    await expect(sharing.invite(owner, `x-${sfx}@mail.dekalbschoolsga.org`, 'CO_TEACHER', [p6])).rejects.toBeInstanceOf(BadRequestException);
    await expect(sharing.invite(outsider, co.email, 'CO_TEACHER', [p6])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(sharing.invite(owner, student.email, 'CO_TEACHER', [p6])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the link works only for the invited district account', async () => {
    const inv = await sharing.invite(owner, co.email.toUpperCase(), 'CO_TEACHER', [p6, p7]);
    expect(inv.classes.map((c) => c.name).sort()).toEqual(['P6', 'P7']);
    expect(sent[sent.length - 1].to).toBe(co.email);
    const token = tokenOf(inv.link);
    const row = await prisma.classroomInvite.findUniqueOrThrow({ where: { id: inv.id } });
    expect(JSON.stringify(row)).not.toContain(token);
    await expect(sharing.accept(outsider, token)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(sharing.accept(student, token)).rejects.toBeInstanceOf(ForbiddenException);
    const pv = await sharing.preview(outsider, token);
    expect(pv.emailMatches).toBe(false);
    expect(JSON.stringify(pv)).not.toContain('stu');
    expect((await sharing.accept(co, token)).classes).toHaveLength(2);
    await expect(sharing.accept(co, token)).rejects.toBeInstanceOf(GoneException);

    const v = await sharing.invite(owner, viewer.email, 'VIEWER', [p6]);
    await sharing.accept(viewer, tokenOf(v.link));
  });

  it('shared classes appear in the teacher list with the right access', async () => {
    const list = (await classrooms.findAll(1, 50, { ...co, role: 'TEACHER' } as any)).data;
    expect(list.map((c) => [c.name, c.access]).sort()).toEqual([['P6', 'co_teacher'], ['P7', 'co_teacher']]);
    expect(list[0].ownerName).toBe('owner T');
    expect((await classrooms.findAll(1, 50, { ...outsider } as any)).data).toHaveLength(0);
  });

  it('co-teacher can teach; view-only can look but not change; outsider gets nothing', async () => {
    // Roster
    expect(await classrooms.getEnrollments(p6, co)).toHaveLength(1);
    expect(await classrooms.getEnrollments(p6, viewer)).toHaveLength(1);
    await expect(classrooms.getEnrollments(p6, outsider)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(classrooms.getEnrollments(p4, co)).rejects.toBeInstanceOf(ForbiddenException);
    // Reports
    expect((await reports.reportForStudent(co, student.userId)).studentId).toBe(student.userId);
    expect((await reports.reportForStudent(viewer, student.userId)).studentId).toBe(student.userId);
    await expect(reports.reportForStudent(outsider, student.userId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(reports.setClassroomGoal(viewer, p6, 120)).rejects.toBeInstanceOf(ForbiddenException);
    await reports.setClassroomGoal(co, p6, 120);
    // Help conversations
    expect(await tutor.getSessionsForStudent(student.userId, co.userId, 'TEACHER')).toEqual([]);
    await expect(tutor.getSessionsForStudent(student.userId, outsider.userId, 'TEACHER')).rejects.toBeInstanceOf(ForbiddenException);
    // Class Pass
    expect((await classPass.status(p6, viewer)).access).toBe('viewer');
    expect((await classPass.status(p6, co)).access).toBe('co_teacher');
    await expect(classPass.issue(p6, viewer, [student.userId])).rejects.toBeInstanceOf(ForbiddenException);
    expect((await classPass.issue(p6, co, [student.userId])).issued).toHaveLength(1);
    await expect(classPass.setOn(p6, co, false)).rejects.toBeInstanceOf(ForbiddenException); // owner's call
    // Assignments
    await expect(assignments.create({ title: 'V', classroomId: p6 } as any, viewer)).rejects.toBeInstanceOf(ForbiddenException);
    const a = await assignments.create({ title: 'Co HW', classroomId: p6 } as any, co);
    await expect(assignments.remove(a.id, outsider)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await assignments.findAll(undefined, 1, 50, co)).data.map((x) => x.title)).toContain('Co HW');
    // Only the owner shares or deletes
    await expect(sharing.invite(co, outsider.email, 'VIEWER', [p6])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(sharing.list(p6, co)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the owner can change a role and remove a teacher; the teacher can leave', async () => {
    await sharing.setRole(owner, p6, viewer.userId, 'CO_TEACHER');
    expect((await classPass.status(p6, viewer)).access).toBe('co_teacher');
    const l = await sharing.list(p6, owner);
    expect(l.staff.map((s) => s.role).sort()).toEqual(['CO_TEACHER', 'CO_TEACHER']);
    await sharing.remove(owner, p6, viewer.userId);
    await expect(classrooms.getEnrollments(p6, viewer)).rejects.toBeInstanceOf(ForbiddenException);
    await sharing.remove(co, p7, co.userId); // leaves P7 only
    expect((await classrooms.findAll(1, 50, co as any)).data.map((c) => c.name)).toEqual(['P6']);
  });

  it('a cancelled invite stops working, and so does an expired one', async () => {
    const inv = await sharing.invite(owner, outsider.email, 'VIEWER', [p4]);
    await sharing.cancelInvite(owner, inv.id);
    await expect(sharing.accept(outsider, tokenOf(inv.link))).rejects.toBeInstanceOf(GoneException);
    const inv2 = await sharing.invite(owner, outsider.email, 'VIEWER', [p4]);
    await prisma.classroomInvite.update({ where: { id: inv2.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(sharing.accept(outsider, tokenOf(inv2.link))).rejects.toBeInstanceOf(GoneException);
    expect(gmail.email).toContain('gmail');
  });
});
