import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
// Seats moved to common/family so the admin surface can show the same number
// this service enforces. Re-exported below; nothing that imported it from here
// needs to change.
import { DEFAULT_FAMILY_SEATS } from '../../common/family/family';

const SALT_ROUNDS = 10;

export { DEFAULT_FAMILY_SEATS };

@Injectable()
export class ParentExperienceService {
  private readonly logger = new Logger(ParentExperienceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * A parent creates a child's login and links it, in one step.
   *
   * Until this existed a family could pay and then not use the product: the only
   * link endpoint was ORG_ADMIN-only and required a student account that already
   * existed, so a consumer parent — who has no administrator — had no path at
   * all. The child is entitled through the linked parent's plan, so nothing else
   * has to change for access to work.
   *
   * The child's email is a login, not a mailbox. If the parent doesn't supply
   * one we derive a +alias on the parent's own address, so password mail reaches
   * the parent and no child inbox is created.
   */
  async addChild(
    parentId: string,
    input: {
      firstName: string;
      lastName: string;
      grade?: string | null;
      email?: string | null;
      password: string;
    },
  ) {
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      select: { id: true, role: true, email: true, maxStudents: true },
    });
    if (!parent || parent.role !== Role.PARENT) {
      throw new ForbiddenException('Only a parent account can add a child');
    }

    const seats = parent.maxStudents ?? DEFAULT_FAMILY_SEATS;
    const used = await this.prisma.parentStudentLink.count({ where: { parentId } });
    if (used >= seats) {
      throw new BadRequestException(
        `Your plan includes ${seats} child ${seats === 1 ? 'login' : 'logins'}, and ${used} ${used === 1 ? 'is' : 'are'} already in use.`,
      );
    }

    const email =
      input.email?.trim().toLowerCase() ||
      (await this.deriveChildLogin(parent.email, input.firstName));

    const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) {
      throw new ConflictException('That login address is already in use');
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      const student = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: Role.STUDENT,
          profile: {
            create: {
              firstName: input.firstName.trim(),
              lastName: input.lastName.trim(),
              grade: input.grade?.trim() || null,
            },
          },
        },
        select: { id: true, email: true },
      });
      await tx.parentStudentLink.create({ data: { parentId, studentId: student.id } });
      return { id: student.id, email: student.email, seatsUsed: used + 1, seats };
    });
  }

  /**
   * `parent+ada@gmail.com` style login, so reset mail lands in the parent's
   * inbox and no child mailbox is created.
   *
   * Any +alias already on the parent's address is stripped first — a parent
   * signed up as `me+test1@gmail.com` was otherwise given a child login of
   * `me+test1+ada@gmail.com`, which stacks aliases, reads as the parent's own
   * address, and looks like a mistake.
   */
  private async deriveChildLogin(parentEmail: string, firstName: string): Promise<string> {
    const [rawLocal, domain] = parentEmail.split('@');
    const local = (rawLocal ?? '').split('+')[0];
    if (!local || !domain) {
      throw new BadRequestException('Please enter a login address for your child');
    }
    const slug = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'child';
    for (let i = 0; i < 20; i++) {
      const candidate = `${local}+${slug}${i === 0 ? '' : i}@${domain}`.toLowerCase();
      const exists = await this.prisma.user.findUnique({
        where: { email: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Please enter a login address for your child');
  }

  /**
   * Attach an existing scholar to an existing parent. Admin-only (see the
   * controller).
   *
   * ## Seats
   *
   * `addChild()` has always refused to exceed the parent's `maxStudents`, but
   * this path never checked it — so the admin route could quietly put a fourth
   * scholar on a three-seat plan, and the family would be over their allowance
   * with nothing anywhere recording that a person decided it.
   *
   * Exceeding the cap is often exactly right (a comped extra child, a family
   * mid-upgrade), so this does not forbid it: it refuses by default and accepts
   * `allowOverSeatLimit`, which the admin UI only sends after showing the
   * numbers and asking. An override you had to click is a decision; a limit that
   * silently did not apply is a bug waiting to be discovered at renewal.
   */
  async linkParentToStudent(
    parentId: string,
    studentId: string,
    options: { allowOverSeatLimit?: boolean } = {},
  ) {
    const [parent, student, existing, seatsUsed] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: parentId },
        select: { id: true, role: true, maxStudents: true },
      }),
      this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true, role: true } }),
      this.prisma.parentStudentLink.findUnique({
        where: { parentId_studentId: { parentId, studentId } },
      }),
      this.prisma.parentStudentLink.count({ where: { parentId } }),
    ]);

    if (!parent || parent.role !== Role.PARENT) {
      throw new BadRequestException('Parent user not found or role is not PARENT');
    }
    if (!student || student.role !== Role.STUDENT) {
      throw new BadRequestException('Student user not found or role is not STUDENT');
    }
    if (existing) {
      throw new ConflictException('Parent is already linked to this student');
    }

    const seats = parent.maxStudents ?? DEFAULT_FAMILY_SEATS;
    if (seatsUsed >= seats && !options.allowOverSeatLimit) {
      throw new BadRequestException(
        `That parent's plan includes ${seats} child ${seats === 1 ? 'login' : 'logins'} and ` +
          `${seatsUsed} ${seatsUsed === 1 ? 'is' : 'are'} already in use. ` +
          `Link anyway only if you intend to give the family an extra seat.`,
      );
    }

    const link = await this.prisma.parentStudentLink.create({ data: { parentId, studentId } });
    if (seatsUsed >= seats) {
      // Over-cap links are deliberate but must not be invisible. This is the
      // only record that a human chose to exceed the plan.
      this.logger.warn(
        `Admin linked student ${studentId} to parent ${parentId} OVER the seat limit ` +
          `(${seatsUsed + 1} of ${seats}).`,
      );
    }
    return { ...link, seats, seatsUsed: seatsUsed + 1, overSeatLimit: seatsUsed >= seats };
  }

  /**
   * Remove a parent↔scholar link, leaving both accounts standing.
   *
   * Admin-only (see the controller). This is what an admin should reach for
   * when a scholar is attached to the wrong family — the previous alternatives
   * were to delete the scholar's account outright, or to leave it wrong.
   *
   * Note the consequence and say it out loud to whoever asks: if this was the
   * scholar's only link to a paying parent, they lose entitlement the moment it
   * is cut, because `EntitlementService` reads exactly this relation.
   */
  async unlinkParentFromStudent(parentId: string, studentId: string) {
    const existing = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
    });
    if (!existing) {
      throw new NotFoundException('That parent and student are not linked');
    }
    await this.prisma.parentStudentLink.delete({
      where: { parentId_studentId: { parentId, studentId } },
    });
    return { parentId, studentId, unlinked: true as const };
  }

  async getChildren(parentId: string) {
    // Seats travel with the list so the UI can show "2 of 3 used" and hide the
    // add button when full, instead of only discovering the limit on submit.
    const parent = await this.prisma.user.findUnique({
      where: { id: parentId },
      select: { maxStudents: true },
    });
    const seats = parent?.maxStudents ?? DEFAULT_FAMILY_SEATS;

    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      seats,
      seatsUsed: links.length,
      children: links.map((link) => ({
        // `id` and `profile` are what the parent UI actually reads. The flat
        // studentId/firstName/lastName below are kept so nothing that already
        // consumes this shape breaks — without `id` every child card fetched
        // /child/undefined/grades and rendered the login address as the name.
        id: link.student.id,
        profile: {
          firstName: link.student.profile?.firstName ?? null,
          lastName: link.student.profile?.lastName ?? null,
        },
        studentId: link.student.id,
        firstName: link.student.profile?.firstName ?? null,
        lastName: link.student.profile?.lastName ?? null,
        email: link.student.email,
        linkedAt: link.createdAt,
      })),
    };
  }

  async getChildAttendance(parentId: string, studentId: string) {
    await this.assertLinked(parentId, studentId);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, date: { gte: since } },
      select: { date: true, status: true, classroomId: true },
      orderBy: { createdAt: 'desc' },
    });

    const present = this.countAttendance(records, AttendanceStatus.PRESENT);
    const absent = this.countAttendance(records, AttendanceStatus.ABSENT);
    const late = this.countAttendance(records, AttendanceStatus.LATE);
    const excused = this.countAttendance(records, AttendanceStatus.EXCUSED);
    const total = records.length;

    return {
      studentId,
      records,
      summary: {
        present,
        absent,
        late,
        excused,
        attendanceRate: total ? this.round1((present / total) * 100) : 0,
      },
    };
  }

  async getChildGrades(parentId: string, studentId: string) {
    await this.assertLinked(parentId, studentId);
    const grades = await this.prisma.grade.findMany({
      where: { submission: { studentId } },
      include: {
        submission: {
          include: {
            assignment: { select: { title: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const rows = grades.map((grade) => ({
      assignmentTitle: grade.submission.assignment.title,
      score: grade.score,
      maxScore: grade.maxScore,
      percentage: this.round1(grade.maxScore > 0 ? (grade.score / grade.maxScore) * 100 : 0),
      gradedAt: grade.createdAt,
    }));

    return {
      studentId,
      grades: rows,
      summary: {
        averagePercentage: rows.length
          ? this.round1(rows.reduce((sum, grade) => sum + grade.percentage, 0) / rows.length)
          : 0,
        totalGraded: rows.length,
      },
    };
  }

  async getChildAlerts(parentId: string, studentId: string) {
    await this.assertLinked(parentId, studentId);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [absences, masteryScores] = await Promise.all([
      this.prisma.attendanceRecord.count({
        where: {
          studentId,
          status: AttendanceStatus.ABSENT,
          date: { gte: since },
        },
      }),
      this.prisma.masteryScore.findMany({
        where: { studentId, score: { lt: 0.6 } },
        select: { skillTag: true, score: true, updatedAt: true },
        orderBy: { score: 'asc' },
      }),
    ]);

    const alerts: {
      type: 'ATTENDANCE' | 'MASTERY';
      detail: string;
      severity: 'HIGH' | 'MEDIUM';
      createdAt: Date;
    }[] = [];

    if (absences >= 3) {
      alerts.push({
        type: 'ATTENDANCE',
        detail: `${absences} absences recorded in the last 30 days`,
        severity: absences >= 5 ? 'HIGH' : 'MEDIUM',
        createdAt: new Date(),
      });
    }

    alerts.push(
      ...masteryScores.map((score) => ({
        type: 'MASTERY' as const,
        detail: `Mastery score ${(score.score * 100).toFixed(0)}% in skill: ${score.skillTag}`,
        severity: score.score < 0.4 ? ('HIGH' as const) : ('MEDIUM' as const),
        createdAt: score.updatedAt,
      })),
    );

    return { studentId, alerts, total: alerts.length };
  }

  private async assertLinked(parentId: string, studentId: string): Promise<void> {
    const link = await this.prisma.parentStudentLink.findUnique({
      where: { parentId_studentId: { parentId, studentId } },
      select: { id: true },
    });
    if (!link) throw new ForbiddenException('Not linked to this student');
  }

  private countAttendance(
    records: { status: AttendanceStatus }[],
    status: AttendanceStatus,
  ): number {
    return records.filter((record) => record.status === status).length;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
