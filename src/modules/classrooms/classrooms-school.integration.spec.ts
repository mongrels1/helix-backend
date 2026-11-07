/**
 * Real-database test: a classroom can only be filed under the teacher's own
 * school, never under EdKairos's house organization. Skipped unless
 * INTEGRATION_DATABASE_URL points at a throwaway Postgres. Never production.
 */
import { ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { UsersRepository } from '../users/users.repository';
import { ClassroomsRepository } from './classrooms.repository';
import { ClassroomsService } from './classrooms.service';

const URL = process.env.INTEGRATION_DATABASE_URL;
const run = URL ? describe : describe.skip;

run('classroom school picker (real DB)', () => {
  let prisma: PrismaService;
  let orgs: OrganizationsRepository;
  let svc: ClassroomsService;
  const sfx = randomUUID().slice(0, 8);
  let house: string, school: string, other: string, member: string;
  let teacher: { userId: string; role: any; email: string };
  let memberTeacher: { userId: string; role: any; email: string };
  const admin = { userId: randomUUID(), role: 'SUPER_ADMIN' as any, email: 'a@x.test' };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    prisma = new PrismaService();
    await prisma.$connect();
    orgs = new OrganizationsRepository(prisma);
    svc = new ClassroomsService(new ClassroomsRepository(prisma), orgs, new UsersRepository(prisma));
    house = (await prisma.organization.upsert({ where: { slug: 'helix-lms' }, update: {}, create: { name: 'Edkairos LMS', slug: 'helix-lms' } })).id;
    school = (await prisma.organization.create({ data: { name: `Redan ${sfx}`, slug: `redan-${sfx}` } })).id;
    other = (await prisma.organization.create({ data: { name: `Other ${sfx}`, slug: `other-${sfx}` } })).id;
    member = (await prisma.organization.create({ data: { name: `Member ${sfx}`, slug: `member-${sfx}` } })).id;
    const t = await prisma.user.create({ data: { email: `t-${sfx}@x.test`, passwordHash: 'x', role: 'TEACHER' } });
    const t2 = await prisma.user.create({ data: { email: `t2-${sfx}@x.test`, passwordHash: 'x', role: 'TEACHER' } });
    teacher = { userId: t.id, role: 'TEACHER', email: t.email };
    memberTeacher = { userId: t2.id, role: 'TEACHER', email: t2.email };
    await prisma.membership.create({ data: { userId: t2.id, organizationId: member, role: 'TEACHER' } });
    // The teacher already teaches one class at the school, and some under the house org.
    await prisma.classroom.create({ data: { name: 'Redan', organizationId: school, teacherId: t.id } });
    await prisma.classroom.create({ data: { name: 'EdKairos Above-Grade', organizationId: house, teacherId: t.id } });
  });

  afterAll(async () => { await prisma.$disconnect(); });

  it("lists the teacher's own school only — not the house org or other schools", async () => {
    expect((await orgs.schoolsFor(teacher.userId, 'TEACHER')).map((o) => o.id)).toEqual([school]);
    expect((await orgs.schoolsFor(memberTeacher.userId, 'TEACHER')).map((o) => o.id)).toEqual([member]);
  });

  it('lists every organization for a super-admin', async () => {
    const ids = (await orgs.schoolsFor(admin.userId, 'SUPER_ADMIN')).map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([house, school, other, member]));
  });

  it('creates a class in the own school; refuses the house org and other schools', async () => {
    const c = await svc.create({ name: 'Period 4', organizationId: school } as any, teacher.userId, teacher);
    expect(c.organizationId).toBe(school);
    await expect(svc.create({ name: 'X', organizationId: house } as any, teacher.userId, teacher)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.create({ name: 'X', organizationId: other } as any, teacher.userId, teacher)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await svc.create({ name: 'Staff', organizationId: house } as any, teacher.userId, admin)).organizationId).toBe(house);
  });

  it('existing house-org classes can still be edited, but not moved into another school', async () => {
    const existing = await prisma.classroom.findFirstOrThrow({ where: { teacherId: teacher.userId, organizationId: house, name: 'EdKairos Above-Grade' } });
    await svc.update(existing.id, { name: 'EdKairos Above-Grade', organizationId: house } as any, teacher as any);
    await expect(svc.update(existing.id, { organizationId: other } as any, teacher as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await svc.update(existing.id, { organizationId: school } as any, teacher as any)).organizationId).toBe(school);
  });
});
