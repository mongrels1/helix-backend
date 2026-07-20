import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

/**
 * Canonical email form so one person maps to exactly ONE account regardless of
 * the casing/whitespace they (or an upstream purchase webhook) send. Writes are
 * stored canonical; reads match case-insensitively so pre-existing mixed-case
 * rows are still found without a data migration.
 */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

const userSelect = {
  id: true,
  email: true,
  role: true,
  plan: true,
  planStatus: true,
  planRenewsAt: true,
  maxStudents: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  suspendedAt: true,
  profile: {
    select: {
      firstName: true,
      lastName: true,
      avatarUrl: true,
      grade: true,
    },
  },
};

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number, limit: number): Promise<[UserEntity[], number]> {
    const skip = (page - 1) * limit;
    const where = { deletedAt: null };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return [users, total];
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        email: { equals: normalizeEmail(email), mode: 'insensitive' },
        deletedAt: null,
      },
    });
  }

  async create(data: CreateUserDto, passwordHash: string): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        email: normalizeEmail(data.email),
        passwordHash,
        role: data.role,
        profile: {
          create: {
            firstName: data.firstName,
            lastName: data.lastName,
            ...(data.grade !== undefined ? { grade: data.grade } : {}),
          },
        },
      },
      select: userSelect,
    });
  }

  async update(id: string, data: UpdateUserDto): Promise<UserEntity> {
    const { firstName, lastName, grade, password, ...userData } = data;

    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id, deletedAt: null },
        data: userData,
      }),
      ...(firstName !== undefined || lastName !== undefined || grade !== undefined
        ? [
            this.prisma.profile.updateMany({
              where: { userId: id, user: { deletedAt: null } },
              data: {
                ...(firstName !== undefined ? { firstName } : {}),
                ...(lastName !== undefined ? { lastName } : {}),
                ...(grade !== undefined ? { grade } : {}),
              },
            }),
          ]
        : []),
    ]);

    const user = await this.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** Pause: block sign-in and revoke existing refresh tokens so the session ends now. */
  async suspend(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id, deletedAt: null },
        data: { suspendedAt: new Date() },
      }),
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
    ]);
  }

  /** Restart a paused account. */
  async restore(id: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, deletedAt: null },
      data: { suspendedAt: null },
    });
  }

  /**
   * Footprint used to decide whether an account is safe to permanently delete.
   * Real-customer data lives in these relations; the service blocks deletion
   * when any are non-zero.
   */
  async countActivity(id: string): Promise<{
    enrollments: number;
    submissions: number;
    taughtClassrooms: number;
    instructorContent: number;
  }> {
    const [enrollments, submissions, taughtClassrooms, instructorContent] =
      await Promise.all([
        this.prisma.enrollment.count({ where: { studentId: id } }),
        this.prisma.submission.count({ where: { studentId: id } }),
        this.prisma.classroom.count({ where: { teacherId: id } }),
        this.prisma.instructorContent.count({ where: { teacherId: id } }),
      ]);
    return { enrollments, submissions, taughtClassrooms, instructorContent };
  }

  /**
   * Permanently remove a user plus their self-generated child rows in one
   * transaction, FK-safe (deepest children first). Heavy relations
   * (enrollments/submissions/classrooms/content) are intentionally NOT deleted
   * here: the service guard blocks deletion whenever any exist, so if one is
   * present the final delete throws and the whole transaction rolls back.
   */
  async hardDelete(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.tutorMessage.deleteMany({ where: { session: { studentId: id } } }),
      this.prisma.tutorSession.deleteMany({ where: { studentId: id } }),
      this.prisma.masteryHistory.deleteMany({ where: { masteryScore: { studentId: id } } }),
      this.prisma.masteryScore.deleteMany({ where: { studentId: id } }),
      this.prisma.pacingRecommendation.deleteMany({ where: { studentId: id } }),
      this.prisma.diagnosticSession.deleteMany({ where: { userId: id } }),
      this.prisma.attendanceRecord.deleteMany({
        where: { OR: [{ studentId: id }, { recordedById: id }] },
      }),
      this.prisma.gradeHistory.deleteMany({ where: { changedById: id } }),
      this.prisma.message.deleteMany({ where: { senderId: id } }),
      this.prisma.threadParticipant.deleteMany({ where: { userId: id } }),
      this.prisma.notification.deleteMany({ where: { userId: id } }),
      this.prisma.notificationPreference.deleteMany({ where: { userId: id } }),
      this.prisma.fileRecord.deleteMany({ where: { ownerId: id } }),
      this.prisma.parentStudentLink.deleteMany({
        where: { OR: [{ parentId: id }, { studentId: id }] },
      }),
      this.prisma.referral.deleteMany({ where: { referrerId: id } }),
      this.prisma.referralCode.deleteMany({ where: { userId: id } }),
      this.prisma.membership.deleteMany({ where: { userId: id } }),
      this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
      this.prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
      this.prisma.profile.deleteMany({ where: { userId: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
  }
}
