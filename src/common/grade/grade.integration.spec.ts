/**
 * Real-database test: every student ends up with a grade, even if the
 * teacher forgets the dropdown. Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassPassService } from '../../modules/class-pass/class-pass.service';
import { ClassroomsService } from '../../modules/classrooms/classrooms.service';
import { ClassroomsRepository } from '../../modules/classrooms/classrooms.repository';
import { OrganizationsRepository } from '../../modules/organizations/organizations.repository';
import { UsersRepository } from '../../modules/users/users.repository';
import { ReportsService } from '../../modules/reports/reports.service';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;

run('grades (real DB)', () => {
  let prisma: PrismaService;
  let cp: ClassPassService;
  let classrooms: ClassroomsService;
  let reports: ReportsService;
  const sfx = randomUUID().slice(0, 8);
  let teacher: { userId: string; role: any; email: string };
  let orgId: string;

  const gradesIn = async (classroomId: string) =>
    (await prisma.enrollment.findMany({ where: { classroomId }, select: { student: { select: { profile: { select: { firstName: true, grade: true } } } } } }))
      .map((e) => `${e.student.profile?.firstName}:${e.student.profile?.grade}`).sort();

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    cp = new ClassPassService(prisma, { get: () => undefined } as any, { issueSessionFor: jest.fn() } as any);
    classrooms = new ClassroomsService(new ClassroomsRepository(prisma), new OrganizationsRepository(prisma), new UsersRepository(prisma));
    reports = new ReportsService(prisma, {} as any, { get: () => undefined } as any);
    orgId = (await prisma.organization.create({ data: { name: `G ${sfx}`, slug: `g-${sfx}`, rosterEnabled: true } })).id;
    const t = await prisma.user.create({ data: { email: `gt-${sfx}@x.test`, passwordHash: 'x', role: 'TEACHER' } });
    teacher = { userId: t.id, role: 'TEACHER', email: t.email };
    await prisma.membership.create({ data: { userId: t.id, organizationId: orgId, role: 'TEACHER' } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('refuses to add students when neither the class nor the teacher gives a grade', async () => {
    const c = await prisma.classroom.create({ data: { name: 'No grade', organizationId: orgId, teacherId: teacher.userId } });
    await expect(cp.addStudents(c.id, teacher, ['Ann Lee'])).rejects.toBeInstanceOf(BadRequestException);
    expect(await gradesIn(c.id)).toEqual([]);
  });

  it('picking a grade once sets the class grade; later adds without the dropdown inherit it', async () => {
    const c = await prisma.classroom.create({ data: { name: 'P7', organizationId: orgId, teacherId: teacher.userId } });
    await cp.addStudents(c.id, teacher, ['Ann Lee'], '7');
    expect((await prisma.classroom.findUniqueOrThrow({ where: { id: c.id } })).gradeLevel).toBe('7');
    await cp.addStudents(c.id, teacher, ['Bo Diaz']); // dropdown forgotten
    expect(await gradesIn(c.id)).toEqual(['Ann:7', 'Bo:7']);
    const r = await reports.buildStudentReport((await prisma.profile.findFirstOrThrow({ where: { firstName: 'Bo', user: { enrollments: { some: { classroomId: c.id } } } } })).userId);
    expect(r.grade).toBe('7');
  });

  it("repairs tonight's case: students already saved without a grade get the class grade", async () => {
    const c = await prisma.classroom.create({ data: { name: 'P6', organizationId: orgId, teacherId: teacher.userId } });
    for (const n of ['Cy', 'Di']) {
      await prisma.user.create({ data: { email: `${n}-${sfx}@x.invalid`, passwordHash: 'x', role: 'STUDENT', profile: { create: { firstName: n, lastName: 'X' } }, enrollments: { create: { classroomId: c.id } } } });
    }
    const keeps = await prisma.user.create({ data: { email: `ev-${sfx}@x.invalid`, passwordHash: 'x', role: 'STUDENT', profile: { create: { firstName: 'Ev', lastName: 'X', grade: '8' } }, enrollments: { create: { classroomId: c.id } } } });
    expect(await gradesIn(c.id)).toEqual(['Cy:null', 'Di:null', 'Ev:8']);
    // Teacher sets the class grade (Class Pass tab or New Classroom form → PATCH /classrooms/:id).
    await classrooms.update(c.id, { gradeLevel: '7' } as any, teacher as any);
    expect(await gradesIn(c.id)).toEqual(['Cy:7', 'Di:7', 'Ev:8']); // an existing 8 is never overwritten
    expect((await reports.buildStudentReport(keeps.id)).grade).toBe('8');
    await expect(classrooms.update(c.id, { gradeLevel: 'banana' } as any, teacher as any)).rejects.toBeInstanceOf(BadRequestException);
    await classrooms.update(c.id, { gradeLevel: 'Grade 6' } as any, teacher as any);
    expect((await prisma.classroom.findUniqueOrThrow({ where: { id: c.id } })).gradeLevel).toBe('6');
    expect(await gradesIn(c.id)).toEqual(['Cy:7', 'Di:7', 'Ev:8']); // changing the class grade never overwrites students
  });

  it('a class created with a grade passes it to students enrolled later', async () => {
    const c = await classrooms.create({ name: 'P5', organizationId: orgId, gradeLevel: '6' } as any, teacher.userId, teacher);
    expect(c.gradeLevel).toBe('6');
    const s = await prisma.user.create({ data: { email: `fa-${sfx}@x.invalid`, passwordHash: 'x', role: 'STUDENT', profile: { create: { firstName: 'Fa', lastName: 'X' } } } });
    await classrooms.enroll(c.id, { studentId: s.id } as any);
    expect(await gradesIn(c.id)).toEqual(['Fa:6']);
  });
});
