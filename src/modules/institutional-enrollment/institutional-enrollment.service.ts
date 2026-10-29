import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EnrollDto } from './dto/enroll.dto';
import { addMonths, hashAccessCode, isPlausibleAccessCode } from './access-code';

const SALT_ROUNDS = 12;
/** One message for missing, unknown and already-used codes, so the endpoint cannot be used to test which codes exist. */
const BAD_CODE = 'That access code is not valid or has already been used. Please check the code on your flyer, or ask your teacher.';
const SET_PASSWORD_TTL_DAYS = 30;

/**
 * Free institutional enrollment — the Redan model.
 *
 * ONE submit creates the parent, the child, and the link between them. The child
 * gets full access without any Stripe object ever existing, because
 * EntitlementService already treats a STUDENT as entitled when a linked PARENT
 * has planStatus 'active'. So we set the PARENT active with planRenewsAt null
 * (never expires) and create no customer and no subscription. Nothing in the
 * billing path can later flip it, because the Stripe webhook only ever updates
 * users it finds by an email Stripe already knows — and Stripe never knows these.
 *
 * That is the whole guarantee behind "no charge, no trial that turns into a
 * charge, no credit card and no subscription" on a form a parent signs.
 *
 * Both rows are stamped planSource INSTITUTIONAL. The Stripe webhook refuses to
 * write to anything that is not STRIPE, so the guarantee is now enforced by the
 * billing path rather than by the assumption that Stripe will never see the
 * address.
 */
@Injectable()
export class InstitutionalEnrollmentService {
  private readonly logger = new Logger(InstitutionalEnrollmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /** Public pre-flight: what the enrollment page renders before anyone types. */
  async describe(token: string) {
    const org = await this.findOpenOrg(token);
    return {
      name: org.name,
      slug: org.slug,
      seatsRemaining:
        org.enrollmentCap === null ? null : Math.max(0, org.enrollmentCap - org.enrollmentsUsed),
      // The page shows the code field (prefilled from ?code=) only when true.
      requiresAccessCode: org.requireAccessCode,
    };
  }

  async enroll(token: string, dto: EnrollDto, ip?: string, userAgent?: string) {
    // Honeypot: hidden field, so anything in it is a bot. Answer 201-shaped
    // nothing rather than an error, so the bot learns nothing.
    if (dto.website) {
      this.logger.warn(`enroll honeypot tripped from ${ip ?? 'unknown'}`);
      return { enrolled: true, studentLoginEmail: null, parentSetPasswordUrl: null };
    }

    if (!dto.consentAccess || !dto.consentProviderAndAi || !dto.consentDataUse || !dto.consentHoldHarmless) {
      throw new BadRequestException('All consents are required to enroll.');
    }

    const org = await this.findOpenOrg(token);
    // A school that hands out per-student codes cannot be enrolled with the
    // shared token alone — the token is in the public repository. Reject a
    // missing or malformed code before any account work or lookup.
    const codeHash = org.requireAccessCode
      ? (isPlausibleAccessCode(dto.accessCode) ? hashAccessCode(dto.accessCode as string) : null)
      : null;
    if (org.requireAccessCode && !codeHash) {
      throw new BadRequestException(BAD_CODE);
    }
    const parentEmail = dto.parentEmail.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { email: parentEmail },
      select: { id: true, role: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      // Deliberately not "create a second child on the existing account" yet —
      // that path needs the parent authenticated, or anyone knowing the address
      // could attach a child to it.
      throw new ConflictException(
        'An account already exists for that email. Please sign in and add your child from your dashboard.',
      );
    }

    // Students authenticate with a generated address; the parent receives the
    // credentials. Mirrors the roster model, where the school hands out a
    // printed credential sheet and no student email is required.
    const studentEmail = `s.${randomUUID()}@students.edkairos.local`;
    const parentHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const studentTempHash = await bcrypt.hash(randomBytes(24).toString('hex'), SALT_ROUNDS);
    const studentName = `${dto.studentFirstName.trim()} ${dto.studentLastName.trim()}`.trim();
    const plan = `${org.slug}-institutional-free`;

    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read the cap inside the transaction so two simultaneous submits on
      // the last seat cannot both win.
      const fresh = await tx.organization.findUnique({
        where: { id: org.id },
        select: { enrollmentCap: true, enrollmentsUsed: true },
      });
      if (!fresh) {
        throw new NotFoundException('This enrollment link is not active.');
      }
      // A null cap means unlimited. Otherwise the seat must still be free as of
      // THIS transaction — findOpenOrg checked it too, but that read happened
      // outside the lock and two parents can reach the last seat together.
      if (fresh.enrollmentCap !== null && fresh.enrollmentsUsed >= fresh.enrollmentCap) {
        throw new ConflictException(
          'This school has reached its enrollment limit. Please contact your teacher.',
        );
      }

      // Claim the code. The conditional update on redeemedAt IS NULL is the
      // single-use guarantee: of two simultaneous submits with one code, exactly
      // one updates a row. Any throw below rolls the claim back with everything
      // else, so a failed enrollment never burns a family's code.
      let freeUntil: Date | null = null;
      let codeId: string | null = null;
      if (codeHash) {
        const code = await tx.enrollmentAccessCode.findFirst({
          where: { codeHash, organizationId: org.id, redeemedAt: null },
          select: { id: true, freeMonths: true },
        });
        if (!code) throw new BadRequestException(BAD_CODE);
        const now = new Date();
        const claimed = await tx.enrollmentAccessCode.updateMany({
          where: { id: code.id, redeemedAt: null },
          data: { redeemedAt: now },
        });
        if (claimed.count !== 1) throw new BadRequestException(BAD_CODE);
        codeId = code.id;
        freeUntil = addMonths(now, code.freeMonths);
      }

      const parent = await tx.user.create({
        data: {
          email: parentEmail,
          passwordHash: parentHash,
          role: Role.PARENT,
          // The entitlement itself. No Stripe customer, no subscription.
          // Without a code, planRenewsAt is null so isPlanActive() never ages
          // out. With a code, it is the end of the free period: isPlanActive()
          // turns false on that date and the family drops to the free tier.
          // Nothing is ever charged — no Stripe object exists to charge.
          plan,
          planStatus: 'active',
          planRenewsAt: freeUntil,
          // Provenance, so the Stripe webhook can refuse to touch this row. The
          // comment above used to argue Stripe "never knows these" emails - true
          // until a Redan parent buys anything personally, after which one
          // past_due would revoke a free family's access with no trace.
          planSource: 'INSTITUTIONAL',
          profile: {
            create: {
              firstName: dto.parentName.trim().split(/\s+/)[0] ?? dto.parentName.trim(),
              lastName: dto.parentName.trim().split(/\s+/).slice(1).join(' ') || '-',
              ...(dto.parentPhone ? { phone: dto.parentPhone.trim() } : {}),
            },
          },
          notificationPreferences: {
            create: { email: dto.notifyEmail ?? false, push: false, inApp: true },
          },
        },
        select: { id: true },
      });

      const student = await tx.user.create({
        data: {
          email: studentEmail,
          passwordHash: studentTempHash,
          role: Role.STUDENT,
          // The child is entitled through the parent link, not their own plan,
          // but the row still needs provenance so Stripe cannot write to it and
          // so the child is never shown a counter or a price.
          planSource: 'INSTITUTIONAL',
          profile: {
            create: {
              firstName: dto.studentFirstName.trim(),
              lastName: dto.studentLastName.trim(),
              ...(dto.gradeLevel ? { grade: dto.gradeLevel } : {}),
              ...(dto.studentIdExternal ? { studentId: dto.studentIdExternal.trim() } : {}),
            },
          },
        },
        select: { id: true },
      });

      await tx.parentStudentLink.create({ data: { parentId: parent.id, studentId: student.id } });
      await tx.membership.createMany({
        data: [
          { userId: parent.id, organizationId: org.id, role: Role.PARENT },
          { userId: student.id, organizationId: org.id, role: Role.STUDENT },
        ],
      });

      await tx.enrollmentConsent.create({
        data: {
          organizationId: org.id,
          parentId: parent.id,
          studentId: student.id,
          parentName: dto.parentName.trim(),
          parentEmail,
          parentPhone: dto.parentPhone?.trim() ?? null,
          relationship: dto.relationship,
          studentName,
          gradeLevel: dto.gradeLevel ?? null,
          classPeriod: dto.classPeriod ?? null,
          studentIdExternal: dto.studentIdExternal?.trim() ?? null,
          consentAccess: dto.consentAccess,
          consentProviderAndAi: dto.consentProviderAndAi,
          consentDataUse: dto.consentDataUse,
          consentHoldHarmless: dto.consentHoldHarmless,
          notifyEmail: dto.notifyEmail ?? false,
          notifySms: dto.notifySms ?? false,
          consentVersion: dto.consentVersion,
          consentText: dto.consentText,
          ipAddress: ip ?? null,
          userAgent: userAgent ?? null,
        },
      });

      await tx.organization.update({
        where: { id: org.id },
        data: { enrollmentsUsed: { increment: 1 } },
      });

      if (codeId) {
        await tx.enrollmentAccessCode.update({
          where: { id: codeId },
          data: { redeemedByParentId: parent.id, redeemedStudentId: student.id },
        });
      }

      return { parentId: parent.id, studentId: student.id, freeUntil };
    });

    // The child's account has no usable password; the parent sets it.
    const token32 = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: result.studentId,
        token: token32,
        expiresAt: new Date(Date.now() + SET_PASSWORD_TTL_DAYS * 86400_000),
      },
    });
    // Same key every other link-builder in this codebase uses. The fallback is
    // the real app, NOT localhost — a set-password link pointing at localhost is
    // an account nobody can ever sign in to.
    const frontendUrl = (
      this.config.get<string>('app.frontendUrl') ?? 'https://app.edkairos.com'
    ).replace(/\/$/, '');
    const studentSetPasswordUrl = `${frontendUrl}/reset-password?token=${token32}`;

    try {
      await this.email.sendWelcomeEmail(parentEmail, dto.parentName.trim().split(/\s+/)[0]);
    } catch (e) {
      this.logger.warn(`enroll welcome email failed for ${parentEmail}: ${(e as Error).message}`);
    }

    this.logger.log(`institutional enroll: ${org.slug} parent=${result.parentId} student=${result.studentId}`);
    return {
      enrolled: true,
      studentLoginEmail: studentEmail,
      studentSetPasswordUrl,
      // ISO date the free access ends, or null when it does not expire.
      freeAccessEndsAt: result.freeUntil ? result.freeUntil.toISOString() : null,
    };
  }

  private async findOpenOrg(token: string) {
    const org = await this.prisma.organization.findFirst({
      where: { enrollmentToken: token, publicEnrollmentEnabled: true, deletedAt: null },
      select: {
        id: true, name: true, slug: true,
        enrollmentCap: true, enrollmentsUsed: true, requireAccessCode: true,
      },
    });
    // One shape for "wrong token" and "switched off" so the endpoint cannot be
    // used to enumerate which schools exist.
    if (!org) throw new NotFoundException('This enrollment link is not active.');
    if (org.enrollmentCap !== null && org.enrollmentsUsed >= org.enrollmentCap) {
      throw new ConflictException('This school has reached its enrollment limit.');
    }
    return org;
  }
}
