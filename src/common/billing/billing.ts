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
 * The owner account. Stripe must never write a plan status onto it: the owner's
 * email can appear on a test, personal or legacy subscription, and a single
 * `past_due` webhook would then mark the platform's own account delinquent.
 */
export function isOwnerAccount(role: string | null | undefined): boolean {
  return role === Role.SUPER_ADMIN;
}
