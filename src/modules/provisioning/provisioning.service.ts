import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '@modules/email/email.service';
import { UsersRepository } from '@modules/users/users.repository';
import type { CreateUserDto } from '@modules/users/dto/create-user.dto';
import { ReferralService } from '@modules/referral/referral.service';

const SALT_ROUNDS = 12;
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const DEFAULT_PERIOD_MS = 31 * 24 * 60 * 60 * 1000; // ~1 month if GHL sends no renewal date

// Fallback plan label when the GHL webhook omits a product field, so a paid
// account is never left with a null plan. NOTE: this only fixes the *label* —
// family/tier detection (PARENT role + seat count) still needs GHL to send
// `product`; without it we assume the default single-student plan.
const DEFAULT_PLAN_LABEL = 'EdKairos Standard';

/** Loosely-typed GHL purchase webhook payload (field names vary by workflow). */
type GhlPayload = Record<string, unknown> & {
  email?: string; Email?: string;
  first_name?: string; firstName?: string;
  last_name?: string; lastName?: string;
  full_name?: string; name?: string;
  product?: string; product_name?: string; productName?: string; tag?: string;
  type?: string; event?: string; event_type?: string; status?: string;
  next_billing_date?: string; current_period_end?: string; renewal_date?: string;
  contact?: { email?: string; first_name?: string; last_name?: string };
  referred_by?: string; referredBy?: string; ref?: string; referral_code?: string;
};

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly referrals: ReferralService,
  ) {}

  /**
   * Provision an account from a GHL purchase. Verifies the shared secret,
   * defensively reads the buyer's email/name/product, creates the account if new
   * (as STUDENT), records the purchased plan, mints a one-time activation token,
   * and emails a "set your password & get started" link. Returns the link too,
   * so a GHL workflow can also deliver it.
   */
  async provisionFromGhl(payload: GhlPayload, providedSecret: string): Promise<{
    created: boolean;
    email: string;
    loginUrl: string;
    status: 'active' | 'canceled';
  }> {
    const expected = (this.config.get<string>('ghl.webhookSecret') ?? '').trim();
    if (!expected) {
      this.logger.error('GHL provisioning blocked: GHL_WEBHOOK_SECRET is not configured');
      throw new UnauthorizedException('Provisioning not configured');
    }
    if (!providedSecret || providedSecret !== expected) {
      throw new UnauthorizedException('Invalid provisioning secret');
    }

    const email = this.pickEmail(payload);
    if (!email) {
      throw new BadRequestException({ error: { code: 'no_email', message: 'A buyer email is required' } });
    }

    // Cancellation / refund: revoke access (keep the account + history). Never
    // creates a user. Access ends now; planRenewsAt is left as-is for reference.
    if (this.isCancel(payload)) {
      const u = await this.users.findByEmail(email);
      if (u) {
        await this.prisma.user.update({ where: { id: u.id }, data: { planStatus: 'canceled' } });
        this.logger.log(`Subscription canceled for ${email}`);
      }
      return { created: false, email, loginUrl: '', status: 'canceled' as const };
    }

    // Active payment — a new purchase OR a renewal. Grants/extends access.
    const { firstName, lastName } = this.pickName(payload);
    const product = this.pickProduct(payload);
    const config = this.planConfig(product);
    const renewsAt = this.pickRenewsAt(payload) ?? new Date(Date.now() + DEFAULT_PERIOD_MS);

    const existing = await this.users.findByEmail(email);
    let userId: string;
    let created = false;
    if (existing) {
      userId = existing.id;
    } else {
      const tempPassword = randomBytes(24).toString('hex');
      const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
      // A family product creates a PARENT (holds the family subscription + adds
      // child logins); single products create a STUDENT.
      const newUser = await this.users.create(
        { email, firstName, lastName, role: config.role, password: tempPassword } as CreateUserDto,
        passwordHash,
      );
      userId = newUser.id;
      created = true;
    }

    await this.prisma.user
      .update({
        where: { id: userId },
        data: {
          // Record a plan label even if GHL didn't send a product, so the
          // account is never left with a null plan (see DEFAULT_PLAN_LABEL).
          plan: product ?? DEFAULT_PLAN_LABEL,
          planStatus: 'active',
          planRenewsAt: renewsAt,
          // Seat limit tracks the resolved plan (null = single-student default).
          maxStudents: config.maxStudents,
        },
      })
      .catch((err) => this.logger.warn(`Could not set entitlement for ${email}: ${String(err)}`));

    // Only NEW accounts get an activation email + set-password link. Renewals on
    // an existing account just extend access silently.
    let loginUrl = '';
    if (created) {
      const token = randomBytes(32).toString('hex');
      await this.prisma.passwordResetToken.create({
        data: { userId, token, expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS) },
      });
      const frontendUrl = (this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000').replace(/\/$/, '');
      loginUrl = `${frontendUrl}/reset-password?token=${token}`;
      try {
        await this.email.sendActivationEmail(email, loginUrl, firstName);
      } catch (err) {
        this.logger.error(`Activation email failed for ${email}: ${String(err)}`);
      }
    }

    // Referral reward: only a brand-new (first-payment) account carrying a code qualifies.
    if (created) {
      const referralCode = this.pickReferralCode(payload);
      if (referralCode) {
        await this.referrals.handleReferredFirstPayment(referralCode, email);
      }
    }
    this.logger.log(
      `Provisioned ${created ? 'NEW' : 'renewal/existing'} active account for ${email}` +
        `${product ? ` (plan: ${product})` : ''} until ${renewsAt.toISOString()}`,
    );
    return { created, email, loginUrl, status: 'active' as const };
  }

  private pickEmail(p: GhlPayload): string {
    const raw = p.email ?? p.Email ?? p.contact?.email ?? '';
    const email = String(raw).trim().toLowerCase();
    return email.includes('@') ? email : '';
  }

  private pickName(p: GhlPayload): { firstName: string; lastName: string } {
    let first = String(p.first_name ?? p.firstName ?? p.contact?.first_name ?? '').trim();
    let last = String(p.last_name ?? p.lastName ?? p.contact?.last_name ?? '').trim();
    if (!first) {
      const full = String(p.full_name ?? p.name ?? '').trim();
      if (full) {
        const parts = full.split(/\s+/);
        first = parts[0] ?? '';
        last = last || parts.slice(1).join(' ');
      }
    }
    return { firstName: first || 'EdKairos', lastName: last || 'Learner' };
  }

  private pickProduct(p: GhlPayload): string | null {
    const raw = p.product ?? p.product_name ?? p.productName ?? p.tag ?? '';
    const v = String(raw).trim();
    return v || null;
  }

  private pickReferralCode(p: GhlPayload): string | null {
    const raw = p.referred_by ?? p.referredBy ?? p.ref ?? p.referral_code ?? '';
    const v = String(raw).trim();
    return v || null;
  }
  /** Map a purchased product to the account role + seat limit. A "family"
   *  product → PARENT who can add multiple child logins; everything else →
   *  a single STUDENT. Seat count is tunable here. */
  private planConfig(product: string | null): { role: Role; maxStudents: number | null } {
    const p = (product ?? '').toLowerCase();
    if (p.includes('family')) return { role: Role.PARENT, maxStudents: 6 };
    return { role: Role.STUDENT, maxStudents: null };
  }

  /** True when the webhook represents a cancellation/refund (revoke access). */
  private isCancel(p: GhlPayload): boolean {
    const raw = String(p.type ?? p.event ?? p.event_type ?? p.status ?? '').toLowerCase();
    return /cancel|refund|chargeback|revoke/.test(raw);
  }

  /** Access-until date from the payload, if GHL sends one; else null (→ default ~1 month). */
  private pickRenewsAt(p: GhlPayload): Date | null {
    const raw = p.next_billing_date ?? p.current_period_end ?? p.renewal_date ?? '';
    if (!raw) return null;
    const d = new Date(String(raw));
    return isNaN(d.getTime()) ? null : d;
  }
}
