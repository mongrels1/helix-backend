import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '@modules/stripe/stripe.service';
import { EmailService } from '@modules/email/email.service';

const MAX_REWARDS = 3;

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly email: EmailService,
  ) {}

  async getOrCreateCode(userId: string): Promise<string> {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing.code;
    for (let i = 0; i < 5; i++) {
      const code = randomBytes(5).toString('hex');
      try {
        const created = await this.prisma.referralCode.create({ data: { userId, code } });
        return created.code;
      } catch {
        const again = await this.prisma.referralCode.findUnique({ where: { userId } });
        if (again) return again.code;
      }
    }
    throw new Error('Could not generate referral code');
  }

  async rewardsGranted(userId: string): Promise<number> {
    return this.prisma.referral.count({ where: { referrerId: userId, status: 'REWARDED' } });
  }

  async handleReferredFirstPayment(code: string, refereeEmail: string): Promise<void> {
    try {
      const normalizedCode = code.trim().toLowerCase();
      const refEmail = refereeEmail.trim().toLowerCase();
      if (!normalizedCode || !refEmail) return;

      const rc = await this.prisma.referralCode.findUnique({
        where: { code: normalizedCode },
        include: { user: true },
      });
      if (!rc) { this.logger.warn(`Referral code not found: ${normalizedCode}`); return; }
      const referrer = rc.user;

      if (referrer.email.toLowerCase() === refEmail) return this.record(referrer.id, refEmail, 'SKIPPED', 'self_referral');

      const dupe = await this.prisma.referral.findUnique({
        where: { referrerId_refereeEmail: { referrerId: referrer.id, refereeEmail: refEmail } },
      });
      if (dupe) { this.logger.log(`Referral already processed: ${referrer.email} <- ${refEmail}`); return; }

      if ((await this.rewardsGranted(referrer.id)) >= MAX_REWARDS)
        return this.record(referrer.id, refEmail, 'SKIPPED', 'cap_reached');

      if (referrer.planStatus !== 'active')
        return this.record(referrer.id, refEmail, 'SKIPPED', 'referrer_not_active');

      const result = await this.stripe.applyReferralRewardByEmail(referrer.email);
      if (!result.applied) {
        this.logger.error(`Referral reward not applied for ${referrer.email}: ${result.reason}`);
        return this.record(referrer.id, refEmail, 'FAILED', result.reason ?? 'stripe_failed');
      }

      await this.record(referrer.id, refEmail, 'REWARDED', null);
      this.logger.log(`Referral REWARDED: ${referrer.email} +1 free month (referred ${refEmail})`);
      try { await this.email.sendReferralRewardEmail(referrer.email); }
      catch (err) { this.logger.error(`Referral reward email failed for ${referrer.email}: ${String(err)}`); }
    } catch (err) {
      this.logger.error(`handleReferredFirstPayment error: ${String(err)}`);
    }
  }

  private async record(referrerId: string, refereeEmail: string, status: 'REWARDED' | 'SKIPPED' | 'FAILED', note: string | null): Promise<void> {
    await this.prisma.referral
      .create({ data: { referrerId, refereeEmail, status: status as never, note } })
      .catch((e) => this.logger.warn(`Could not record referral: ${String(e)}`));
  }
}
