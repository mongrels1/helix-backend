import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly couponId: string;

  constructor(private readonly config: ConfigService) {
    const key = (this.config.get<string>('stripe.secretKey') ?? '').trim();
    this.couponId = (this.config.get<string>('stripe.referralCouponId') ?? '').trim();
    this.stripe = key ? new Stripe(key) : null;
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
}
