import { dayKey } from '../usage/usage.constants';

/**
 * Self-serve teacher accounts.
 *
 * A teacher may create their own account, free, when their email is on an
 * approved school domain and they prove they own the address (the normal
 * verify-before-create link). They get the teacher tools - Lesson Plan Maker
 * first among them - and no students: learners still arrive only by paying or
 * by EdKairos enrolling them.
 *
 * This file is the single answer to "which emails may self-register as a
 * teacher", "is this row a self-serve teacher" and "how many lesson plans may
 * one generate". Every other TEACHER row is created by an admin and is
 * untouched by anything here.
 */

/** Domains approved when TEACHER_SIGNUP_DOMAINS is not set. */
const DEFAULT_TEACHER_DOMAINS = ['dekalbschoolsga.org'];

/** Stored in User.plan to mark a teacher who registered themselves. */
export const SELF_SERVE_TEACHER_PLAN = 'teacher-self-serve';

/** DailyUsage.kind for a generated lesson plan. */
export const LESSON_PLAN_USAGE_KIND = 'LESSON_PLAN';

/** Lesson plans a self-serve teacher may generate per day, unless overridden. */
const DEFAULT_DAILY_LESSON_PLANS = 5;

/** Approved domains, lower-cased. TEACHER_SIGNUP_DOMAINS is a comma list. */
export function teacherSignupDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.TEACHER_SIGNUP_DOMAINS;
  const list = (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return list.length ? list : DEFAULT_TEACHER_DOMAINS;
}

/**
 * True when the address is on an approved school domain. Exact domain match
 * only: `x@mail.dekalbschoolsga.org` and `x@notdekalbschoolsga.org` both fail.
 */
export function isApprovedTeacherEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return teacherSignupDomains(env).includes(domain);
}

/** True for a teacher who registered themselves (not admin-created staff). */
export function isSelfServeTeacher(
  role: string | null | undefined,
  plan: string | null | undefined,
): boolean {
  return role === 'TEACHER' && plan === SELF_SERVE_TEACHER_PLAN;
}

/** Daily lesson-plan allowance for a self-serve teacher. */
export function dailyLessonPlanAllowance(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.TEACHER_FREE_DAILY_LESSON_PLANS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LESSON_PLANS;
}

export { dayKey as lessonPlanDayKey };
