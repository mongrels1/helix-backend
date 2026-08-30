/**
 * The free tier's daily allowance.
 *
 * This is a usage cap, not a trial. The category evidence (IXL 10 questions per
 * subject per day, Photomath ~5 solves) is that unlimited *access* with limited
 * *quantity* converts better than a locked door, because the prospect
 * self-qualifies by hitting the cap wanting more. An expiry date fires once; a
 * daily cap fires every day, and every reset is another chance to convert.
 *
 * Every number the product enforces is in this file. Change it here and the
 * guard, the counter, the nudge and the parent digest all follow.
 */

/** Metered features. Values are stored in DailyUsage.kind. */
export const USAGE_KINDS = ['TUTOR', 'PRACTICE'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** Steady-state free allowance, per day, per feature. */
export const DAILY_ALLOWANCE: Record<UsageKind, number> = {
  TUTOR: 3,
  PRACTICE: 3,
};

/**
 * First-session allowance.
 *
 * At three items a student can meet the wall in about ninety seconds, and a
 * wall met before the product is seen teaches them the product IS a wall. The
 * first day is therefore larger, so the first thing a family experiences is the
 * tutor working rather than a price. This is what makes a cap of three safe.
 */
export const INTRO_ALLOWANCE: Record<UsageKind, number> = {
  TUTOR: 10,
  PRACTICE: 10,
};

/** How long the intro allowance lasts, from account creation. */
export const INTRO_WINDOW_HOURS = 24;

/**
 * The business timezone. The reset boundary is "local midnight" for a Georgia
 * product, and deciding it in one place keeps the server, the counter and the
 * unique index on DailyUsage agreeing about which day it is.
 */
export const BUSINESS_TIMEZONE = 'America/New_York';

/** 'YYYY-MM-DD' for the given instant in the business timezone. */
export function dayKey(at: Date = new Date(), timeZone = BUSINESS_TIMEZONE): string {
  // en-CA formats as YYYY-MM-DD, which sorts and indexes correctly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** True while the account is still inside its first-session window. */
export function isIntroWindow(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() < INTRO_WINDOW_HOURS * 3600 * 1000;
}

/** The allowance that applies to this account right now. */
export function allowanceFor(kind: UsageKind, createdAt: Date, now: Date = new Date()): number {
  return isIntroWindow(createdAt, now) ? INTRO_ALLOWANCE[kind] : DAILY_ALLOWANCE[kind];
}
