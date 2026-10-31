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

/**
 * DailyUsage.kind for a generated lesson plan. The row's `day` holds the
 * Monday of the week (see lessonPlanWeekKey), so one row counts a whole week.
 * A new kind, so the old per-day 'LESSON_PLAN' rows are never read as weeks.
 */
export const LESSON_PLAN_USAGE_KIND = 'LESSON_PLAN_WEEK';

/**
 * Lesson plans a self-serve teacher may generate per week, unless overridden.
 * One plan covers a full teaching week, so one is a week of planning
 * (John, 31 Oct 2026). It was 5 a day.
 */
const DEFAULT_WEEKLY_LESSON_PLANS = 1;

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
 * True when the address is on an approved school domain, or is itself listed
 * in TEACHER_SIGNUP_EMAILS. Exact domain match
 * only: `x@mail.dekalbschoolsga.org` and `x@notdekalbschoolsga.org` both fail.
 *
 * A `+` in the name part is refused on approved domains: school mail delivers
 * `name+anything@` to `name@`, so one teacher could open unlimited free
 * accounts. An exact address in TEACHER_SIGNUP_EMAILS (a test inbox) still
 * passes.
 */
export function isApprovedTeacherEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1) return false;
  if (teacherSignupEmails(env).includes(address)) return true;
  if (address.slice(0, at).includes('+')) return false;
  return teacherSignupDomains(env).includes(address.slice(at + 1));
}

/**
 * Individually approved addresses, lower-cased. TEACHER_SIGNUP_EMAILS is a
 * comma list of exact addresses: one teacher at a school whose domain is not
 * approved, or a test inbox. Empty by default.
 */
export function teacherSignupEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.TEACHER_SIGNUP_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True for a teacher who registered themselves (not admin-created staff). */
export function isSelfServeTeacher(
  role: string | null | undefined,
  plan: string | null | undefined,
): boolean {
  return role === 'TEACHER' && plan === SELF_SERVE_TEACHER_PLAN;
}

/** Weekly lesson-plan allowance for a self-serve teacher. */
export function weeklyLessonPlanAllowance(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.TEACHER_FREE_WEEKLY_LESSON_PLANS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WEEKLY_LESSON_PLANS;
}

/**
 * 'YYYY-MM-DD' of the Monday that starts this week, in the business timezone.
 * The week resets at midnight Eastern going into Monday.
 */
export function lessonPlanWeekKey(at: Date = new Date()): string {
  const [y, m, d] = dayKey(at).split('-').map(Number);
  const local = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - sinceMonday);
  return local.toISOString().slice(0, 10);
}
