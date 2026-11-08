import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClassroomStaffRole, Prisma, Role } from '@prisma/client';

/**
 * The ONE place that decides who may see or work in a class. Every module asks
 * here instead of comparing classroom.teacherId itself, so sharing a class
 * (ClassroomStaff) and school-admin rights behave the same everywhere.
 *
 *   view   – owner, school admin, co-teacher, view-only teacher
 *   teach  – owner, school admin, co-teacher (assign, add students, new pages)
 *   manage – owner, school admin (share, turn Class Pass off, delete the class)
 */
export type ClassroomNeed = 'view' | 'teach' | 'manage';
export type ClassroomAccessLevel = 'owner' | 'admin' | 'co_teacher' | 'viewer';
export interface AccessCaller {
  userId: string;
  role: Role | string;
}

type PrismaLike = {
  membership: { findFirst(args: any): Promise<{ id: string } | null> };
  classroomStaff: { findUnique(args: any): Promise<{ role: ClassroomStaffRole } | null> };
  classroom: { findFirst(args: any): Promise<any> };
};

const RANK: Record<ClassroomAccessLevel, number> = { viewer: 1, co_teacher: 2, admin: 3, owner: 3 };
const NEEDS: Record<ClassroomNeed, number> = { view: 1, teach: 2, manage: 3 };

/** Prisma filter: classes this user owns or that are shared with them. */
export function accessibleClassroomWhere(userId: string, need: Exclude<ClassroomNeed, 'manage'> = 'view'): Prisma.ClassroomWhereInput {
  return {
    OR: [
      { teacherId: userId },
      { staff: { some: need === 'teach' ? { userId, role: ClassroomStaffRole.CO_TEACHER } : { userId } } },
    ],
  };
}

export async function isSchoolAdmin(prisma: PrismaLike, caller: AccessCaller, organizationId: string): Promise<boolean> {
  if (caller.role === Role.SUPER_ADMIN) return true;
  if (caller.role !== Role.ORG_ADMIN) return false;
  const m = await prisma.membership.findFirst({
    where: { userId: caller.userId, organizationId, role: Role.ORG_ADMIN },
    select: { id: true },
  });
  return !!m;
}

/** This caller's level on a class they already loaded, or null for none. */
export async function classroomAccessLevel(
  prisma: PrismaLike,
  classroom: { id: string; teacherId: string; organizationId: string },
  caller: AccessCaller,
): Promise<ClassroomAccessLevel | null> {
  if (classroom.teacherId === caller.userId) return 'owner';
  if (await isSchoolAdmin(prisma, caller, classroom.organizationId)) return 'admin';
  if (caller.role !== Role.TEACHER && caller.role !== Role.ORG_ADMIN) return null;
  const s = await prisma.classroomStaff.findUnique({
    where: { classroomId_userId: { classroomId: classroom.id, userId: caller.userId } },
    select: { role: true },
  });
  if (!s) return null;
  return s.role === ClassroomStaffRole.CO_TEACHER ? 'co_teacher' : 'viewer';
}

export function levelAllows(level: ClassroomAccessLevel | null, need: ClassroomNeed): boolean {
  return !!level && RANK[level] >= NEEDS[need];
}

/** Throws 403 unless the caller has at least `need` on this (loaded) class. */
export async function assertClassroomAccess(
  prisma: PrismaLike,
  classroom: { id: string; teacherId: string; organizationId: string },
  caller: AccessCaller,
  need: ClassroomNeed,
): Promise<ClassroomAccessLevel> {
  const level = await classroomAccessLevel(prisma, classroom, caller);
  if (!levelAllows(level, need)) {
    throw new ForbiddenException(
      level === 'viewer'
        ? 'You have view-only access to this class.'
        : level === 'co_teacher'
          ? 'Only the class owner can do that.'
          : 'You do not have access to this classroom',
    );
  }
  return level!;
}

/** Load a live class by id and check access in one step. */
export async function loadClassroomWithAccess<S extends Prisma.ClassroomSelect>(
  prisma: PrismaLike,
  classroomId: string,
  caller: AccessCaller,
  need: ClassroomNeed,
  select: S,
): Promise<{ classroom: Prisma.ClassroomGetPayload<{ select: S & { id: true; teacherId: true; organizationId: true } }>; level: ClassroomAccessLevel }> {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, deletedAt: null },
    select: { ...select, id: true, teacherId: true, organizationId: true },
  });
  if (!classroom) throw new NotFoundException('Classroom not found');
  const level = await assertClassroomAccess(prisma, classroom, caller, need);
  return { classroom, level };
}
