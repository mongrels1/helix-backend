import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StripeLib = require('stripe');

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly couponId: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const key = (this.config.get<string>('stripe.secretKey') ?? '').trim();
    this.couponId = (this.config.get<string>('stripe.referralCouponId') ?? '').trim();
    this.webhookSecret = (this.config.get<string>('stripe.webhookSecret') ?? '').trim();
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
      default:
        return { handled: false, action: event.type };
    }
  }

  private async syncSubscription(
    sub: Stripe.Subscription,
  ): Promise<{ handled: boolean; action?: string; email?: string }> {
    const email = await this.customerEmail(sub.customer);
    if (!email) {
      this.logger.warn(`Stripe ${sub.status} sub ${sub.id}: no resolvable customer email`);
      return { handled: true, action: `no_email:${sub.status}` };
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

    const found = await this.applyEntitlement(email, planStatus, renewsAt);
    return { handled: true, action: `${sub.status}->${planStatus}${found ? '' : ':no_user'}`, email };
  }

  private async customerEmail(
    customer: string | Stripe.Customer | Stripe.DeletedCustomer,
  ): Promise<string | null> {
    if (typeof customer !== 'string') {
      if ('deleted' in customer && customer.deleted) return null;
      return (customer as Stripe.Customer).email ?? null;
    }
    if (!this.stripe) return null;
    try {
      const c = await this.stripe.customers.retrieve(customer);
      if ((c as Stripe.DeletedCustomer).deleted) return null;
      return (c as Stripe.Customer).email ?? null;
    } catch (err) {
      this.logger.error(`Could not retrieve Stripe customer ${customer}: ${String(err)}`);
      return null;
    }
  }

  private async applyEntitlement(
    email: string,
    planStatus: string,
    renewsAt: Date | null | undefined,
  ): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      this.logger.warn(`Stripe webhook: no active account for ${email} (-> ${planStatus})`);
      return false;
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { planStatus, ...(renewsAt !== undefined ? { planRenewsAt: renewsAt } : {}) },
    });
    this.logger.log(`Stripe webhook: ${email} -> planStatus=${planStatus}`);
    return true;
  }
}
