import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { EmailService } from '@modules/email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportRosterDto, RosterRowInput } from './dto/import-roster.dto';

// Trial schools cap each teacher at 25 students; a contract sets its own number
// (Organization.perTeacherCap), and a single teacher can be overridden via
// User.maxStudents. Effective cap = maxStudents ?? perTeacherCap ?? 25.
const TRIAL_DEFAULT_CAP = 25;

// Roster-provisioned students have no usable password until they set one. The
// invite link is long-lived (teachers may hand out the printed sheet days later).
const SET_PASSWORD_TTL_DAYS = 14;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RosterCaller = { userId: string; role: Role };

type RowOutcome = 'created' | 'enrolled' | 'matched' | 'skipped';

interface RowResult {
  row: number;
  name: string;
  studentId: string;
  email: string;
  outcome: RowOutcome;
  reason?: string;
  setPasswordUrl?: string;
}

export interface RosterImportResult {
  classroomId: string;
  plan: 'TRIAL' | 'CONTRACT';
  cap: number;
  totalRows: number;
  created: number;
  enrolled: number;
  matched: number;
  skipped: number;
  emailInvitesEnabled: boolean;
  emailInvitesSent: number;
  results: RowResult[];
}

@Injectable()
export class RosterService {
  private readonly logger = new Logger(RosterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  async importRoster(
    classroomId: string,
    caller: RosterCaller,
    dto: ImportRosterDto,
  ): Promise<RosterImportResult> {
    // 1. Classroom + authorization: the class owner, or an org/super admin.
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, deletedAt: null },
      select: { id: true, teacherId: true, organizationId: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');

    const isOwner = classroom.teacherId === caller.userId;
    const isAdmin =
      caller.role === Role.ORG_ADMIN || caller.role === Role.SUPER_ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You do not have access to this classroom');
    }

    // 2. Org approval gate — a super-admin must have enabled this school first.
    const org = await this.prisma.organization.findUnique({
      where: { id: classroom.organizationId },
      select: {
        id: true,
        rosterEnabled: true,
        studentEmailInvites: true,
        perTeacherCap: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.rosterEnabled) {
      throw new ForbiddenException(
        'This school is not yet approved for roster uploads. Ask an EdKairos admin to enable it.',
      );
    }

    // 3. Effective cap — always measured against the class OWNER's roster, even
    //    when an admin runs the upload on their behalf.
    const teacher = await this.prisma.user.findUnique({
      where: { id: classroom.teacherId },
      select: { maxStudents: true },
    });
    const cap = teacher?.maxStudents ?? org.perTeacherCap ?? TRIAL_DEFAULT_CAP;
    const plan: 'TRIAL' | 'CONTRACT' =
      org.perTeacherCap == null ? 'TRIAL' : 'CONTRACT';

    // 4. Distinct students this teacher has already provisioned across all their
    //    classes — the running total the cap is checked against.
    const existing = await this.prisma.enrollment.findMany({
      where: { classroom: { teacherId: classroom.teacherId, deletedAt: null } },
      select: { studentId: true },
      distinct: ['studentId'],
    });
    const roster = new Set<string>(existing.map((e) => e.studentId));

    const frontendUrl = (
      this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');

    const results: RowResult[] = [];
    const seenEmails = new Set<string>();
    let created = 0;
    let enrolled = 0;
    let matched = 0;
    let skipped = 0;
    let emailInvitesSent = 0;

    for (let i = 0; i < dto.rows.length; i++) {
      const raw = dto.rows[i] ?? {};
      const { firstName, lastName } = this.parseName(raw);
      const studentId = (raw.studentId ?? '').trim();
      const email = (raw.email ?? '').trim().toLowerCase();
      const grade = (raw.grade ?? '').trim() || undefined;

      const base = {
        row: i + 1,
        name: `${firstName} ${lastName}`.trim(),
        studentId,
        email,
      };
      const skip = (reason: string): void => {
        results.push({ ...base, outcome: 'skipped', reason });
        skipped++;
      };

      if (!firstName) {
        skip('missing name');
        continue;
      }
      if (!studentId) {
        skip('missing student ID');
        continue;
      }
      if (!email || !EMAIL_RE.test(email)) {
        skip('missing or invalid email');
        continue;
      }
      if (seenEmails.has(email)) {
        skip('duplicate email in file');
        continue;
      }
      seenEmails.add(email);

      try {
        const existingUser = await this.prisma.user.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            deletedAt: null,
          },
          select: {
            id: true,
            role: true,
            profile: { select: { studentId: true, grade: true } },
          },
        });

        if (existingUser) {
          if (existingUser.role !== Role.STUDENT) {
            skip('email belongs to a non-student account');
            continue;
          }
          // A matched student not yet on this teacher's roster still takes a seat.
          if (!roster.has(existingUser.id) && roster.size >= cap) {
            skip(`quota reached (cap ${cap})`);
            continue;
          }
          // Backfill missing studentId/grade; never overwrite existing values.
          const profilePatch = {
            ...(existingUser.profile?.studentId ? {} : { studentId }),
            ...(grade && !existingUser.profile?.grade ? { grade } : {}),
          };
          if (Object.keys(profilePatch).length > 0) {
            await this.prisma.profile.updateMany({
              where: { userId: existingUser.id },
              data: profilePatch,
            });
          }
          await this.prisma.membership.upsert({
            where: {
              userId_organizationId: {
                userId: existingUser.id,
                organizationId: org.id,
              },
            },
            create: {
              userId: existingUser.id,
              organizationId: org.id,
              role: Role.STUDENT,
            },
            update: {},
          });
          const already = await this.prisma.enrollment.findFirst({
            where: { classroomId, studentId: existingUser.id },
            select: { id: true },
          });
          roster.add(existingUser.id);
          if (already) {
            results.push({ ...base, outcome: 'matched' });
            matched++;
          } else {
            await this.prisma.enrollment.create({
              data: { classroomId, studentId: existingUser.id },
            });
            results.push({ ...base, outcome: 'enrolled' });
            enrolled++;
          }
          continue;
        }

        // New student. Guard against reusing a studentId already taken by a
        // different account in the same school.
        const idClash = await this.prisma.user.findFirst({
          where: {
            role: Role.STUDENT,
            deletedAt: null,
            memberships: { some: { organizationId: org.id } },
            profile: { studentId },
          },
          select: { id: true },
        });
        if (idClash) {
          skip('student ID already used in this school by a different email');
          continue;
        }

        if (roster.size >= cap) {
          skip(`quota reached (cap ${cap})`);
          continue;
        }

        // Create account + profile + org membership + enrollment atomically.
        const passwordHash = await bcrypt.hash(
          randomBytes(24).toString('hex'),
          12,
        );
        const newUser = await this.prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              email,
              passwordHash,
              role: Role.STUDENT,
              profile: {
                create: {
                  firstName,
                  lastName,
                  studentId,
                  ...(grade ? { grade } : {}),
                },
              },
            },
            select: { id: true },
          });
          await tx.membership.create({
            data: { userId: u.id, organizationId: org.id, role: Role.STUDENT },
          });
          await tx.enrollment.create({
            data: { classroomId, studentId: u.id },
          });
          return u;
        });
        roster.add(newUser.id);

        // Long-lived set-password link (the account has no usable password yet).
        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(
          Date.now() + SET_PASSWORD_TTL_DAYS * 24 * 60 * 60 * 1000,
        );
        await this.prisma.passwordResetToken.create({
          data: { userId: newUser.id, token, expiresAt },
        });
        const setPasswordUrl = `${frontendUrl}/reset-password?token=${token}`;

        // Only email the student if the school opted in; otherwise the teacher
        // hands out the link from the printable results. Parents are never emailed.
        if (org.studentEmailInvites) {
          try {
            await this.email.sendPasswordResetEmail(email, setPasswordUrl);
            emailInvitesSent++;
          } catch (e) {
            this.logger.warn(
              `roster invite email failed for ${email}: ${(e as Error).message}`,
            );
          }
        }

        results.push({ ...base, outcome: 'created', setPasswordUrl });
        created++;
      } catch (e) {
        this.logger.error(
          `roster row ${i + 1} failed: ${(e as Error).message}`,
        );
        skip(`error: ${(e as Error).message}`);
      }
    }

    return {
      classroomId,
      plan,
      cap,
      totalRows: dto.rows.length,
      created,
      enrolled,
      matched,
      skipped,
      emailInvitesEnabled: org.studentEmailInvites,
      emailInvitesSent,
      results,
    };
  }

  // Accepts either a single "name" column or explicit firstName/lastName. Splits
  // a full name on the first space; a single-token name keeps lastName empty
  // (the Profile column is non-null but an empty string is allowed).
  private parseName(raw: RosterRowInput): {
    firstName: string;
    lastName: string;
  } {
    let firstName = (raw.firstName ?? '').trim();
    let lastName = (raw.lastName ?? '').trim();
    const full = (raw.name ?? '').trim();
    if (!firstName && full) {
      const parts = full.split(/\s+/);
      firstName = parts.shift() ?? '';
      lastName = parts.join(' ');
    }
    return { firstName, lastName };
  }
}
