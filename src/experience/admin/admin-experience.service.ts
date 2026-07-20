import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttendanceStatus,
  Prisma,
  Role,
  SubmissionStatus,
  TutorSessionStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getDashboard() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      users,
      organizations,
      classrooms,
      courses,
      assignments,
      submissions,
      activeEnrollments,
      newUsersLast7Days,
      submissionsLast7Days,
      gradedLast7Days,
      atRiskRows,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.classroom.count({ where: { deletedAt: null } }),
      this.prisma.course.count({ where: { deletedAt: null } }),
      this.prisma.assignment.count({ where: { deletedAt: null } }),
      this.prisma.submission.count(),
      this.prisma.enrollment.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.submission.count({ where: { createdAt: { gte: since } } }),
      this.prisma.grade.count({ where: { createdAt: { gte: since } } }),
      this.prisma.attendanceRecord.groupBy({
        by: ['studentId'],
        where: { status: AttendanceStatus.ABSENT },
        orderBy: { studentId: 'asc' },
        _count: { _all: true },
        having: { studentId: { _count: { gte: 3 } } },
      }),
    ]);

    return {
      counts: {
        users,
        organizations,
        classrooms,
        courses,
        assignments,
        submissions,
        activeEnrollments,
      },
      recentActivity: {
        newUsersLast7Days,
        submissionsLast7Days,
        gradedLast7Days,
      },
      atRiskStudents: atRiskRows.length,
    };
  }

  async getUsers(page = 1, limit = 20, role?: Role, search?: string) {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const trimmedSearch = search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(role ? { role } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { email: { contains: trimmedSearch, mode: 'insensitive' } },
              {
                profile: {
                  is: { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
                },
              },
              {
                profile: {
                  is: { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        skip: (normalizedPage - 1) * normalizedLimit,
        take: normalizedLimit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map((user) => {
        const inFunnel = Boolean(user.plan) || Boolean(user.planStatus);
        const hasActivity =
          user._count.enrollments > 0 ||
          user._count.submissions > 0 ||
          user._count.taughtClassrooms > 0 ||
          user._count.instructorContent > 0;
        return {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.profile?.firstName ?? null,
          lastName: user.profile?.lastName ?? null,
          createdAt: user.createdAt,
          deletedAt: user.deletedAt,
          suspendedAt: user.suspendedAt,
          plan: user.plan,
          planStatus: user.planStatus,
          status: user.suspendedAt ? 'paused' : 'active',
          canDelete: !inFunnel && !hasActivity,
        };
      }),
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  async getOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        memberCount: organization._count.memberships,
        createdAt: organization.createdAt,
      })),
      total: organizations.length,
    };
  }

  async getHealth() {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      database,
      redis,
      aiProviders: {
        openai: { configured: Boolean(this.config.get<string>('ai.openaiKey')?.trim()) },
        gemini: { configured: Boolean(this.config.get<string>('ai.googleKey')?.trim()) },
        claude: { configured: Boolean(this.config.get<string>('ai.anthropicKey')?.trim()) },
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getMetrics() {
    const [
      submissionsTotal,
      draftSubmissions,
      submittedSubmissions,
      underReviewSubmissions,
      gradedSubmissions,
      returnedSubmissions,
      notificationsTotal,
      unreadNotifications,
      tutorSessionsTotal,
      activeTutorSessions,
      pacingRecommendationsTotal,
      dismissedPacingRecommendations,
      masteryScoresTotal,
      masteryScoresBelowThreshold,
    ] = await this.prisma.$transaction([
      this.prisma.submission.count(),
      this.prisma.submission.count({ where: { status: SubmissionStatus.DRAFT } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.SUBMITTED } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.UNDER_REVIEW } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.GRADED } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.RETURNED } }),
      this.prisma.notification.count({ where: { deletedAt: null } }),
      this.prisma.notification.count({ where: { readAt: null, deletedAt: null } }),
      this.prisma.tutorSession.count(),
      this.prisma.tutorSession.count({ where: { status: TutorSessionStatus.ACTIVE } }),
      this.prisma.pacingRecommendation.count(),
      this.prisma.pacingRecommendation.count({ where: { dismissed: true } }),
      this.prisma.masteryScore.count(),
      this.prisma.masteryScore.count({ where: { score: { lt: 0.6 } } }),
    ]);

    return {
      submissions: {
        total: submissionsTotal,
        byStatus: {
          DRAFT: draftSubmissions,
          SUBMITTED: submittedSubmissions,
          UNDER_REVIEW: underReviewSubmissions,
          GRADED: gradedSubmissions,
          RETURNED: returnedSubmissions,
        },
      },
      notifications: {
        total: notificationsTotal,
        unread: unreadNotifications,
      },
      tutorSessions: {
        total: tutorSessionsTotal,
        active: activeTutorSessions,
      },
      pacingRecommendations: {
        total: pacingRecommendationsTotal,
        dismissed: dismissedPacingRecommendations,
      },
      masteryScores: {
        total: masteryScoresTotal,
        belowThreshold: masteryScoresBelowThreshold,
      },
    };
  }

  private async checkDatabase(): Promise<{ status: 'ok' | 'error'; latencyMs: number }> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch {
      return { status: 'error', latencyMs: -1 };
    }
  }

  private async checkRedis(): Promise<{ status: 'ok' | 'error' | 'unconfigured' }> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return { status: 'unconfigured' };

    let client: Redis | undefined;
    try {
      client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      await client.connect();
      await client.ping();
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    } finally {
      client?.disconnect();
    }
  }
}
