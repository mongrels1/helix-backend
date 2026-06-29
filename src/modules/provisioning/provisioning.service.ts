import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '@modules/email/email.service';
import { UsersRepository } from '@modules/users/users.repository';
import type { CreateUserDto } from '@modules/users/dto/create-user.dto';

const SALT_ROUNDS = 12;
const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Loosely-typed GHL purchase webhook payload (field names vary by workflow). */
type GhlPayload = Record<string, unknown> & {
  email?: string; Email?: string;
  first_name?: string; firstName?: string;
  last_name?: string; lastName?: string;
  full_name?: string; name?: string;
  product?: string; product_name?: string; productName?: string; tag?: string;
  contact?: { email?: string; first_name?: string; last_name?: string };
};

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly email: EmailService,
    private readonly config: ConfigService,
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
    const { firstName, lastName } = this.pickName(payload);
    const product = this.pickProduct(payload);

    const existing = await this.users.findByEmail(email);
    let userId: string;
    let created = false;
    if (existing) {
      userId = existing.id;
    } else {
      const tempPassword = randomBytes(24).toString('hex');
      const passwordHash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
      const newUser = await this.users.create(
        { email, firstName, lastName, role: Role.STUDENT, password: tempPassword } as CreateUserDto,
        passwordHash,
      );
      userId = newUser.id;
      created = true;
    }

    if (product) {
      await this.prisma.user
        .update({ where: { id: userId }, data: { plan: product } })
        .catch((err) => this.logger.warn(`Could not record plan for ${email}: ${String(err)}`));
    }

    // One-time activation token (reuses the password-reset token table).
    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: { userId, token, expiresAt: new Date(Date.now() + ACTIVATION_TTL_MS) },
    });

    const frontendUrl = (this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000').replace(/\/$/, '');
    const loginUrl = `${frontendUrl}/reset-password?token=${token}`;

    // Best-effort email — never fail provisioning if the email send hiccups; the
    // returned loginUrl can still be delivered by the GHL workflow.
    try {
      await this.email.sendActivationEmail(email, loginUrl, firstName);
    } catch (err) {
      this.logger.error(`Activation email failed for ${email}: ${String(err)}`);
    }

    this.logger.log(`Provisioned ${created ? 'NEW' : 'existing'} account for ${email}${product ? ` (plan: ${product})` : ''}`);
    return { created, email, loginUrl };
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
}
