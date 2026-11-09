import type { Prisma } from '@prisma/client';

/**
 * What a STUDENT (or their family) may see. One place, so every student list,
 * report and page uses the same rules.
 *
 * - Opened: no start date, or the start date has passed. Before that, the
 *   assignment is hidden from students and families.
 * - For this student: no chosen students, or this student is one of them.
 */
export function openToStudents(now: Date = new Date()): Prisma.AssignmentWhereInput {
  return { OR: [{ startsAt: null }, { startsAt: { lte: now } }] };
}

export function targetsStudent(studentId: string): Prisma.AssignmentWhereInput {
  return { OR: [{ targets: { none: {} } }, { targets: { some: { studentId } } }] };
}

/** Both rules together, for a where clause: `{ ..., AND: visibleToStudent(id) }`. */
export function visibleToStudent(studentId: string, now: Date = new Date()): Prisma.AssignmentWhereInput[] {
  return [openToStudents(now), targetsStudent(studentId)];
}

/** True when a student may see this assignment yet. */
export function hasOpened(startsAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !startsAt || startsAt.getTime() <= now.getTime();
}
