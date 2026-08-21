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

const SALT_ROUNDS = 12;
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

      const parent = await tx.user.create({
        data: {
          email: parentEmail,
          passwordHash: parentHash,
          role: Role.PARENT,
          // The entitlement itself. No Stripe customer, no subscription, and
          // planRenewsAt null so isActive() never ages out.
          plan,
          planStatus: 'active',
          planRenewsAt: null,
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

      return { parentId: parent.id, studentId: student.id };
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
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'https://app.edkairos.com';
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
    };
  }

  private async findOpenOrg(token: string) {
    const org = await this.prisma.organization.findFirst({
      where: { enrollmentToken: token, publicEnrollmentEnabled: true, deletedAt: null },
      select: {
        id: true, name: true, slug: true,
        enrollmentCap: true, enrollmentsUsed: true,
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
