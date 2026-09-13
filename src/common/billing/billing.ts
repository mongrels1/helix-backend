import { Role } from '@prisma/client';

/**
 * Accounts that are never billed.
 *
 * Ownership and staff access do not run through Stripe, so a billing status on
 * one of these rows is noise at best and a lockout at worst: any rule of the
 * shape "suspend accounts that are past due" will lock the owner out of their
 * own platform unless it consults this list first.
 *
 * This module is the single answer to "does billing apply to this account?".
 * Enforcement (EntitlementGuard, EntitlementService), the admin user list and
 * the Stripe webhook writer all read it, so the answer cannot drift between
 * them. Any new billing gate must be built on these helpers rather than
 * re-deriving the rule from planStatus.
 */
export const BILLING_EXEMPT_ROLES: readonly string[] = [
  Role.SUPER_ADMIN,
  Role.ORG_ADMIN,
  Role.TEACHER,
];

/** True when the account is staff/owner and therefore never gated by billing. */
export function isBillingExempt(role: string | null | undefined): boolean {
  return !!role && BILLING_EXEMPT_ROLES.includes(role);
}

/**
 * Is this row's own subscription live right now?
 *
 * The one test for "is this plan active", because there were two. The admin
 * user list asked `planStatus === 'active'` and stopped there; EntitlementService
 * asked the same thing *and* checked that the paid period had not run out. So a
 * subscription that lapsed without Stripe having sent the closing webhook read
 * as Paid in the admin list while the product itself had already locked the
 * family out. Both now call this.
 *
 * A null `planRenewsAt` means "no known end date" and stays active — that is how
 * every row behaved before this function existed, and an institutional or comped
 * grant legitimately has no renewal date at all.
 *
 * Note this answers only "does THIS row hold a live plan". A scholar covered by
 * a parent's subscription is false here and entitled anyway; that question
 * belongs to `common/family/family.ts`.
 */
export function isPlanActive(
  planStatus: string | null | undefined,
  planRenewsAt: Date | null | undefined,
): boolean {
  if ((planStatus ?? '').toLowerCase() !== 'active') return false;
  if (planRenewsAt == null) return true;
  return planRenewsAt.getTime() > Date.now();
}

/**
 * The owner account. Stripe must never write a plan status onto it: the owner's
 * email can appear on a test, personal or legacy subscription, and a single
 * `past_due` webhook would then mark the platform's own account delinquent.
 */
export function isOwnerAccount(role: string | null | undefined): boolean {
  return role === Role.SUPER_ADMIN;
}

/**
 * Whether the Stripe webhook is allowed to write a plan status onto this row.
 *
 * `applyEntitlement` matches a Stripe customer to an app user, and until this
 * guard existed that match was by email alone. An institutional or comped
 * family has no Stripe object at all, but they do have an email address — and a
 * Redan parent who ever bought anything personally has an address Stripe knows.
 * One `past_due` on that unrelated subscription would silently revoke a free
 * family's access, with nothing in any dashboard to show why.
 *
 * NULL means "unknown / legacy" and stays writable, so every row that exists
 * today behaves exactly as it does today. Only rows we have positively
 * identified as not-Stripe are protected.
 */
export function isStripeWritable(planSource: string | null | undefined): boolean {
  return planSource === null || planSource === undefined || planSource === 'STRIPE';
}

/** True when the account's access is granted by an institution, not a purchase. */
export function isInstitutional(planSource: string | null | undefined): boolean {
  return planSource === 'INSTITUTIONAL';
}

/**
 * Whether this account should ever be shown a price, a usage counter or an
 * upgrade prompt.
 *
 * Three populations must never see one: staff and the owner (not billed),
 * institutional and comped families (someone else is paying, and the Redan
 * consent form promises "no charge, no trial that turns into a charge, no
 * credit card and no subscription"), and anyone already subscribed.
 *
 * Everyone else — self-serve STUDENT and PARENT — is the audience for it.
 */
export function showsBillingSurface(
  role: string | null | undefined,
  planSource: string | null | undefined,
): boolean {
  if (isBillingExempt(role)) return false;
  if (planSource === 'INSTITUTIONAL' || planSource === 'COMP') return false;
  return true;
}
