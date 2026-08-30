import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { isOwnerAccount, isStripeWritable } from '../../common/billing/billing';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '@modules/email/email.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StripeLib = require('stripe');

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly couponId: string;
  private readonly webhookSecret: string;
  private readonly upgradeUrl: string;
  /**
   * Subscription ids already alerted on, so Stripe's own retries of the same
   * event do not send the same email repeatedly. Deliberately NOT a time-based
   * cooldown like the AI-router alert: every unmatched subscription is a
   * different person who has paid and cannot use what they bought, and a
   * cooldown would swallow the second one.
   */
  private readonly alertedUnmatched = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {
    const key = (this.config.get<string>('stripe.secretKey') ?? '').trim();
    this.couponId = (this.config.get<string>('stripe.referralCouponId') ?? '').trim();
    this.webhookSecret = (this.config.get<string>('stripe.webhookSecret') ?? '').trim();
    this.upgradeUrl = (this.config.get<string>('app.upgradeUrl') ?? 'https://go.edkairos.com').trim();
    this.stripe = key ? (new StripeLib(key) as Stripe) : null;
    if (!this.stripe) this.logger.warn('StripeService disabled: STRIPE_SECRET_KEY not set');
  }

  get enabled(): boolean {
    return this.stripe !== null && this.couponId.length > 0;
  }

  async applyReferralRewardByEmail(email: string): Promise<{ applied: boolean; reason?: string }> {
    if (!this.stripe || !this.couponId) return { applied: false, reason: 'stripe_disabled' };
    const customers = await this.stripe.customers.list({ email: email.toLowerCase(), limit: 10 });
    if (customers.data.length === 0) return { applied: false, reason: 'no_customer' };
    for (const customer of customers.data) {
      const subs = await this.stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 10 });
      const sub = subs.data[0];
      if (sub) {
        await this.stripe.subscriptions.update(sub.id, { discounts: [{ coupon: this.couponId }] });
        this.logger.log(`Applied referral coupon to sub ${sub.id} (${email})`);
        return { applied: true };
      }
    }
    return { applied: false, reason: 'no_active_subscription' };
  }

  // ============ Stripe webhook: keep app access in sync with billing ============

  /**
   * Verify a Stripe webhook payload (raw body + signature) and return the parsed
   * event. Throws if Stripe is disabled, the signing secret is unset, or the
   * signature doesn't match.
   */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe) throw new Error('stripe_disabled');
    if (!this.webhookSecret) throw new Error('stripe_webhook_secret_missing');
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /**
   * Route a subscription-lifecycle event onto the buyer's account so access
   * tracks billing automatically. Matched to the app user by the Stripe customer
   * email (case-insensitive). Unhandled event types are a no-op.
   */
  async handleEvent(event: Stripe.Event): Promise<{ handled: boolean; action?: string; email?: string }> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
      case 'customer.subscription.deleted':
        return this.syncSubscription(event.data.object as Stripe.Subscription);
      case 'customer.subscription.trial_will_end':
        return this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
      default:
        return { handled: false, action: event.type };
    }
  }

  private async syncSubscription(
    sub: Stripe.Subscription,
  ): Promise<{ handled: boolean; action?: string; email?: string }> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
    // A durable key, when the checkout carried one. GHL order forms do not set
    // metadata today, which is exactly why customerId below matters.
    const metaUserId =
      (sub.metadata?.userId as string | undefined) ??
      (sub.metadata?.uid as string | undefined) ??
      null;
    const email = await this.customerEmail(sub.customer);
    if (!email && !customerId && !metaUserId) {
      this.logger.warn(`Stripe ${sub.status} sub ${sub.id}: no resolvable customer identity`);
      return { handled: true, action: `no_identity:${sub.status}` };
    }

    // current_period_end read defensively (its typed location varies by SDK API version).
    const cpe = (sub as unknown as { current_period_end?: number }).current_period_end;
    const periodEnd = cpe ? new Date(cpe * 1000) : null;

    // PAUSE: Stripe (and GHL's "Pause") sets `pause_collection` while often leaving
    // status='active', so check it explicitly and suspend access while paused.
    const paused = (sub as unknown as { pause_collection?: unknown }).pause_collection != null;

    let planStatus: string;
    let renewsAt: Date | null | undefined;
    if (paused) {
      planStatus = 'paused'; // not 'active' -> access suspended until resumed
      renewsAt = periodEnd;
    } else {
      switch (sub.status) {
        case 'active':
        case 'trialing':
          // ACTIVE / UPDATE (plan/price change keeps it active): entitled through
          // the end of the paid period; the date auto-advances on each renewal.
          planStatus = 'active';
          renewsAt = periodEnd;
          break;
        case 'past_due':
        case 'unpaid':
          planStatus = 'past_due'; // failed payment -> suspended until they pay
          renewsAt = periodEnd;
          break;
        case 'paused':
          planStatus = 'paused'; // suspended until resumed
          renewsAt = periodEnd;
          break;
        case 'canceled':
        case 'incomplete_expired':
          // CANCEL: immediate cancel revokes now; a cancel-at-period-end stays
          // 'active' (handled above) until Stripe fires the final deleted event.
          planStatus = 'canceled';
          renewsAt = undefined; // leave the date for reference
          break;
        default:
          planStatus = sub.status; // incomplete -> no active entitlement yet
          renewsAt = undefined;
      }
    }

    const found = await this.applyEntitlement(
      { email, customerId, metaUserId, subscriptionId: sub.id },
      planStatus,
      renewsAt,
    );
    return { handled: true, action: `${sub.status}->${planStatus}${found ? '' : ':no_user'}`, email: email ?? undefined };
  }

  private async getCustomer(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer,
  ): Promise<Stripe.Customer | null> {
    if (typeof customer !== 'string') {
      if ('deleted' in customer && customer.deleted) return null;
      return customer as Stripe.Customer;
    }
    if (!this.stripe) return null;
    try {
      const c = await this.stripe.customers.retrieve(customer);
      if ((c as Stripe.DeletedCustomer).deleted) return null;
      return c as Stripe.Customer;
    } catch (err) {
      this.logger.error(`Could not retrieve Stripe customer ${customer}: ${String(err)}`);
      return null;
    }
  }

  private async customerEmail(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer,
  ): Promise<string | null> {
    const c = await this.getCustomer(customer);
    return c?.email ?? null;
  }

  /**
   * Trial ending (~3 days out). Sends a "subscribe to keep access" reminder ONLY
   * when the trial cannot auto-convert (no payment method on the subscription or
   * customer). Stripe warns this can fire even after payment is collected, so we
   * skip anyone no longer trialing or already carrying a payment method.
   */
  private async handleTrialWillEnd(
    sub: Stripe.Subscription,
  ): Promise<{ handled: boolean; action?: string; email?: string }> {
    if (sub.status !== 'trialing') {
      return { handled: true, action: `trial_will_end:skip_${sub.status}` };
    }
    const customer = await this.getCustomer(sub.customer);
    const email = customer?.email ?? null;
    if (!email) return { handled: true, action: 'trial_will_end:no_email' };

    const subPm = (sub as unknown as { default_payment_method?: unknown }).default_payment_method;
    const custPm = customer?.invoice_settings?.default_payment_method ?? null;
    const custSrc = (customer as unknown as { default_source?: unknown }).default_source ?? null;
    if (subPm != null || custPm != null || custSrc != null) {
      // Payment method on file -> auto-converts to paid; no "subscribe" nudge.
      return { handled: true, action: 'trial_will_end:auto_converts', email };
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, deletedAt: null },
      select: { profile: { select: { firstName: true } } },
    });
    const upgradeUrl = `${this.upgradeUrl}?email=${encodeURIComponent(email)}`;
    try {
      await this.email.sendTrialEndingEmail(email, user?.profile?.firstName, upgradeUrl);
    } catch (err) {
      this.logger.error(`Trial-ending reminder failed for ${email}: ${String(err)}`);
    }
    return { handled: true, action: 'trial_will_end:reminded', email };
  }

  /**
   * Write a plan status onto the buying account.
   *
   * Identity is resolved in order of durability, because email is not a key:
   * a parent may check out with a different address than they registered with,
   * a household shares one inbox, and GHL can hold two contacts on the same
   * address. When that match failed the parent was charged and the child stayed
   * locked out, with nothing in any dashboard to say why.
   *
   *   1. an explicit userId carried in subscription metadata
   *   2. the Stripe customer id, once we have seen it before
   *   3. email - still supported, logged as a soft match, and on success the
   *      customer id is stored so this subscription never needs email again
   *
   * Two accounts are refused outright: the owner (ownership is not billed) and
   * any row whose planSource says the plan did not come from Stripe. An
   * institutional family has no Stripe object, but they do have an email
   * address, and one past_due on an unrelated personal subscription would
   * otherwise revoke a free family's access.
   */
  private async applyEntitlement(
    identity: {
      email: string | null;
      customerId: string | null;
      metaUserId: string | null;
      subscriptionId: string;
    },
    planStatus: string,
    renewsAt: Date | null | undefined,
  ): Promise<boolean> {
    const { email, customerId, metaUserId, subscriptionId } = identity;
    const select = { id: true, role: true, planSource: true, stripeCustomerId: true } as const;

    type MatchedUser = {
      id: string;
      role: string;
      planSource: string | null;
      stripeCustomerId: string | null;
    };
    let user: MatchedUser | null = null;
    let matchedBy = '';

    if (metaUserId) {
      user = (await this.prisma.user.findFirst({
        where: { id: metaUserId, deletedAt: null },
        select,
      })) as MatchedUser | null;
      if (user) matchedBy = 'metadata.userId';
    }
    if (!user && customerId) {
      user = (await this.prisma.user.findFirst({
        where: { stripeCustomerId: customerId, deletedAt: null },
        select,
      })) as MatchedUser | null;
      if (user) matchedBy = 'stripeCustomerId';
    }
    if (!user && email) {
      user = (await this.prisma.user.findFirst({
        where: { email: { equals: email.trim(), mode: 'insensitive' }, deletedAt: null },
        select,
      })) as MatchedUser | null;
      if (user) matchedBy = 'email';
    }

    if (!user) {
      // Loud on purpose. A webhook that resolves to nobody used to return 200
      // and vanish; that silence is how a paying family stays locked out for
      // weeks. Anything that reads these logs should alert on this line.
      const detail =
        `Stripe webhook UNMATCHED: sub ${subscriptionId} -> ${planStatus}; ` +
        `no active account for email=${email ?? 'none'} customer=${customerId ?? 'none'} ` +
        `metaUserId=${metaUserId ?? 'none'}. THE BUYER IS PAYING AND NOT ENTITLED.`;
      this.logger.error(detail);
      await this.alertUnmatched(subscriptionId, detail, email, customerId);
      return false;
    }

    if (isOwnerAccount(user.role)) {
      this.logger.warn(
        `Stripe webhook: ignoring planStatus=${planStatus} for owner account (ownership is not billed)`,
      );
      return true;
    }

    if (!isStripeWritable(user.planSource)) {
      this.logger.warn(
        `Stripe webhook: refusing planStatus=${planStatus} for ${user.id} - ` +
          `planSource=${user.planSource}, so this account's access does not come from Stripe. ` +
          `Matched by ${matchedBy}; the subscription is unrelated to their entitlement.`,
      );
      return true;
    }

    if (matchedBy === 'email') {
      this.logger.warn(
        `Stripe webhook: matched ${user.id} by EMAIL for sub ${subscriptionId}. ` +
          `Email is not a key - storing customer id so future events match durably.`,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        planStatus,
        ...(renewsAt !== undefined ? { planRenewsAt: renewsAt } : {}),
        // First Stripe write on this row establishes provenance, so a later
        // institutional grant cannot be mistaken for a purchase and vice versa.
        ...(user.planSource == null ? { planSource: 'STRIPE' as const } : {}),
        // Backfill the durable key. After this, email is never needed again for
        // this customer.
        ...(customerId && user.stripeCustomerId !== customerId
          ? { stripeCustomerId: customerId }
          : {}),
      },
    });
    this.logger.log(
      `Stripe webhook: ${user.id} -> planStatus=${planStatus} (matched by ${matchedBy})`,
    );
    return true;
  }

  /**
   * Page a human when a payment cannot be attached to an account.
   *
   * A log line only works if somebody is reading the log, and nobody reads a
   * log at 2am. This is the one failure in the billing path where the customer
   * has already been charged and has no way to tell that anything is wrong -
   * they simply find the product still locked and email us, or charge back. It
   * is worth an email every single time.
   *
   * Never allowed to throw: a webhook that 500s because the mail provider is
   * down would make Stripe retry, which makes the problem worse rather than
   * better.
   */
  private async alertUnmatched(
    subscriptionId: string,
    detail: string,
    email: string | null,
    customerId: string | null,
  ): Promise<void> {
    if (this.alertedUnmatched.has(subscriptionId)) return;
    this.alertedUnmatched.add(subscriptionId);
    // Bound the set so a long-lived process cannot grow it without limit.
    if (this.alertedUnmatched.size > 500) {
      this.alertedUnmatched.delete(this.alertedUnmatched.values().next().value as string);
    }

    const body = [
      detail,
      '',
      'A Stripe subscription event could not be matched to any active EdKairos',
      'account. The customer has been charged and their access has NOT been',
      'granted. They will not see an error - the product simply stays locked.',
      '',
      'To fix one of these by hand:',
      `  1. Open the subscription in Stripe: ${subscriptionId}`,
      `  2. Find the app account the family actually uses${email ? ` (they paid as ${email})` : ''}.`,
      `  3. Set that user's stripeCustomerId to ${customerId ?? 'the customer id on the subscription'},`,
      '     then re-send the subscription event from Stripe. It will match on the id',
      '     and never need the email again.',
      '',
      'If these arrive often, the checkout is not carrying uid - check that the',
      'GHL order form passes it through to Stripe metadata.',
    ].join('\n');

    try {
      await this.email.sendAdminAlert(
        '[EdKairos] PAID BUT NOT ENTITLED - a payment could not be matched to an account',
        body,
      );
    } catch (err) {
      this.logger.error(`Failed to send unmatched-payment alert: ${String(err)}`);
    }
  }
}
