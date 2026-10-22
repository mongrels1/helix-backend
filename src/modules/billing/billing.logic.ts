import { isBillingExempt, isPlanActive } from '../../common/billing/billing';

/**
 * Who may open Stripe's hosted billing page, and what the Settings page should
 * say to everyone else. Pure, so the rules are unit-tested without Stripe.
 *
 *   MANAGE             - has a Stripe customer of their own -> "Manage billing"
 *   COVERED_BY_PARENT  - a scholar whose linked parent pays -> "X manages your plan"
 *   NOT_STRIPE_BILLED  - institutional or comped -> "Provided at no cost"
 *                        (the Redan consent form promises no card, ever)
 *   NO_CUSTOMER_ID     - paid, but no durable Stripe key on the row -> "email us",
 *                        and an admin alert. Never fall back to an email lookup:
 *                        email was the join v79 retired.
 *   NO_PLAN            - free account -> "See plans"
 *   STAFF              - teachers, admins, owner -> nothing
 */
export type BillingState =
  | 'MANAGE'
  | 'COVERED_BY_PARENT'
  | 'NOT_STRIPE_BILLED'
  | 'NO_CUSTOMER_ID'
  | 'NO_PLAN'
  | 'STAFF';

export interface BillingRow {
  role: string;
  planSource: string | null;
  planStatus: string | null;
  planRenewsAt: Date | null;
  stripeCustomerId: string | null;
}

/** Statuses that mean money has changed hands at some point. */
const PAID_STATUSES = ['active', 'past_due', 'paused', 'trialing'];

export function billingState(row: BillingRow, coveredByActiveParent: boolean): BillingState {
  if (isBillingExempt(row.role)) return 'STAFF';
  if (row.planSource === 'INSTITUTIONAL' || row.planSource === 'COMP') return 'NOT_STRIPE_BILLED';
  // A scholar riding on a parent's plan: billing belongs to whoever pays.
  if (!isPlanActive(row.planStatus, row.planRenewsAt) && coveredByActiveParent) return 'COVERED_BY_PARENT';
  // Anyone with a customer of their own may open the portal, including a
  // canceled or past-due family: that is exactly when they need their card and invoices.
  if (row.stripeCustomerId) return 'MANAGE';
  if (PAID_STATUSES.includes((row.planStatus ?? '').toLowerCase())) return 'NO_CUSTOMER_ID';
  return 'NO_PLAN';
}

/** The status word shown to the family. Mirrors the admin list's vocabulary. */
export function statusLabel(planStatus: string | null, planRenewsAt: Date | null): 'active' | 'past_due' | 'paused' | 'canceled' | 'none' {
  const s = (planStatus ?? '').toLowerCase();
  if (s === 'active' || s === 'trialing') return isPlanActive('active', planRenewsAt) ? 'active' : 'canceled';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  if (s === 'paused') return 'paused';
  if (s === 'canceled' || s === 'incomplete_expired') return 'canceled';
  return 'none';
}
