import { PrismaClient } from '@prisma/client';

/**
 * Grade levels, one way everywhere: "K" or "1"–"12".
 * A student's grade is their own profile grade if set, otherwise their class's
 * grade. Classes carry a grade so a student added without one still has one.
 */
export const GRADE_VALUES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
export const GRADE_PATTERN = /^(K|[1-9]|1[0-2])$/;

/** "7", "Grade 7", "7th", "k", "kindergarten" → "7" / "K"; anything else → null. */
export function normalizeGrade(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'k' || s.startsWith('kinder')) return 'K';
  const m = /\d{1,2}/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= 12 ? String(n) : null;
}

/** Own grade first, then the first class that has one. */
export function effectiveGrade(own: string | null | undefined, classGrades: (string | null | undefined)[]): string | null {
  return normalizeGrade(own) ?? classGrades.map(normalizeGrade).find((g) => g != null) ?? null;
}

/**
 * Give every student in the class who has NO grade the class's grade.
 * Never overwrites a grade that was set on purpose. Returns how many were filled.
 */
export async function fillMissingGrades(
  prisma: Pick<PrismaClient, 'profile'>,
  classroomId: string,
  grade: string,
): Promise<number> {
  const g = normalizeGrade(grade);
  if (!g) return 0;
  const res = await prisma.profile.updateMany({
    where: {
      OR: [{ grade: null }, { grade: '' }],
      user: { enrollments: { some: { classroomId } } },
    },
    data: { grade: g },
  });
  return res.count;
}
