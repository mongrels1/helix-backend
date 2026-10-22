import { Injectable, Logger, ServiceUnavailableException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '@modules/stripe/stripe.service';
import { EmailService } from '@modules/email/email.service';
import { coveringParent, loadFamilyLinksFor } from '../../common/family/family';
import { billingState, statusLabel, type BillingState } from './billing.logic';

const APP_URL = (process.env.APP_URL ?? 'https://app.edkairos.com').replace(/\/$/, '');

export interface BillingSummary {
  state: BillingState;
  status: 'active' | 'past_due' | 'paused' | 'canceled' | 'none';
  planLabel: string | null;
  renewsAt: string | null;
  /** First name of the paying parent, when state is COVERED_BY_PARENT. */
  coveredBy: string | null;
  canManage: boolean;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  /** Users already alerted on for a missing customer id (one email per user per process). */
  private readonly alertedNoCustomer = new Set<string>();
  /** Simple per-user rate limit for portal links: 5 a minute. */
  private readonly portalHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly email: EmailService,
  ) {}

  private async load(userId: string) {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true, email: true, role: true, plan: true, planStatus: true, planRenewsAt: true,
        planSource: true, stripeCustomerId: true,
      },
    });
    if (!row) throw new HttpException('not_found', HttpStatus.NOT_FOUND);
    const links = await loadFamilyLinksFor(this.prisma, userId);
    const parent = coveringParent(links);
    const state = billingState(
      { role: row.role, planSource: row.planSource ?? null, planStatus: row.planStatus, planRenewsAt: row.planRenewsAt, stripeCustomerId: row.stripeCustomerId },
      parent !== null,
    );
    return { row, parent, state };
  }

  async summary(userId: string): Promise<BillingSummary> {
    const { row, parent, state } = await this.load(userId);
    const covered = state === 'COVERED_BY_PARENT' && parent;
    return {
      state,
      status: covered ? statusLabel(parent.planStatus, parent.planRenewsAt) : statusLabel(row.planStatus, row.planRenewsAt),
      planLabel: covered ? parent.plan : row.plan,
      renewsAt: (covered ? parent.planRenewsAt : row.planRenewsAt)?.toISOString() ?? null,
      coveredBy: covered ? parent.name.split(' ')[0] : null,
      canManage: state === 'MANAGE' && this.stripe.portalEnabled,
    };
  }

  /**
   * A single-use link to Stripe's billing page for the signed-in user's OWN
   * customer. The request carries no ids; everything comes from the session.
   */
  async portalLink(userId: string, role: string): Promise<{ url: string | null; state: BillingState }> {
    this.rateLimit(userId);
    const { row, state } = await this.load(userId);
    if (state === 'NO_CUSTOMER_ID') {
      await this.alertNoCustomer(row.id, row.email, row.planStatus);
      return { url: null, state };
    }
    if (state !== 'MANAGE' || !row.stripeCustomerId) return { url: null, state };
    if (!this.stripe.portalEnabled) throw new ServiceUnavailableException('billing_unavailable');

    const back = role === 'STUDENT' ? '/dashboard/student/settings' : '/dashboard/parent/settings';
    try {
      const url = await this.stripe.createPortalSession(row.stripeCustomerId, `${APP_URL}${back}?billing=returned`);
      this.logger.log(`Billing portal session created for user ${row.id}`);
      return { url, state };
    } catch (err) {
      this.logger.error(`Billing portal session failed for user ${row.id}: ${String(err)}`);
      throw new ServiceUnavailableException('billing_unavailable');
    }
  }

  private rateLimit(userId: string): void {
    const now = Date.now();
    const recent = (this.portalHits.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 5) throw new HttpException('too_many_requests', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.portalHits.set(userId, recent);
    if (this.portalHits.size > 2000) this.portalHits.delete(this.portalHits.keys().next().value as string);
  }

  /** Never throws: a mail failure must not turn into an error page for the family. */
  private async alertNoCustomer(userId: string, email: string, planStatus: string | null): Promise<void> {
    if (this.alertedNoCustomer.has(userId)) return;
    this.alertedNoCustomer.add(userId);
    const body = [
      `User ${userId} (${email}) has planStatus=${planStatus ?? 'null'} but no stripeCustomerId,`,
      'so they could not open the billing page to update their card.',
      '',
      'To fix: find their customer in Stripe (Customers), copy the cus_... id,',
      "and set it as this user's stripeCustomerId. The Manage billing button then works.",
    ].join('\n');
    try {
      await this.email.sendAdminAlert('[EdKairos] A paying family could not open their billing page', body);
    } catch (err) {
      this.logger.error(`Failed to send no-customer alert: ${String(err)}`);
    }
  }
}
