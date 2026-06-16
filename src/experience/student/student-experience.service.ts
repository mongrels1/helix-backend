import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role, SubmissionStatus, TutorSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StudentExperienceService {
  constructor(private readonly prisma: PrismaService) {}

  resolveStudentId(
    requestedStudentId: string | undefined,
    user: { userId: string; role: Role },
  ): string {
    if (user.role === Role.STUDENT) {
      if (requestedStudentId && requestedStudentId !== user.userId) {
        throw new ForbiddenException('Students can only view their own experience');
      }
      return user.userId;
    }
    return requestedStudentId ?? user.userId;
  }

  async getDashboard(studentId: string): Promise<{
    upcomingAssignments: {
      assignmentId: string;
      title: string;
      dueAt: Date | null;
      submissionStatus: SubmissionStatus | null;
    }[];
    recentGrades: {
      assignmentTitle: string;
      score: number;
      maxScore: number;
      gradedAt: Date;
    }[];
    masterySnapshot: {
      averageScore: number;
      skillCount: number;
      belowThreshold: number;
    };
    activeTutorSessions: number;
    unreadNotifications: number;
  }> {
    const now = new Date();
    const nextTwoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const [enrollments, recentGrades, masteryScores, activeTutorSessions, unreadNotifications] =
      await Promise.all([
        this.prisma.enrollment.findMany({
          where: { studentId },
          select: { classroomId: true },
        }),
        this.prisma.grade.findMany({
          where: { submission: { studentId } },
          include: {
            submission: {
              include: { assignment: { select: { title: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.masteryScore.findMany({ where: { studentId } }),
        this.prisma.tutorSession.count({
          where: { studentId, status: TutorSessionStatus.ACTIVE },
        }),
        this.prisma.notification.count({
          where: { userId: studentId, readAt: null, deletedAt: null },
        }),
      ]);
    const classroomIds = enrollments.map((enrollment) => enrollment.classroomId);
    const assignments = await this.prisma.assignment.findMany({
      where: {
        classroomId: { in: classroomIds },
        dueAt: { gte: now, lte: nextTwoWeeks },
        deletedAt: null,
      },
      include: {
        submissions: {
          where: { studentId },
          select: { status: true },
          take: 1,
        },
      },
      orderBy: { dueAt: 'asc' },
      take: 10,
    });
    const averageScore = masteryScores.length
      ? this.round1(
          masteryScores.reduce((sum, score) => sum + score.score, 0) /
            masteryScores.length,
        )
      : 0;

    return {
      upcomingAssignments: assignments.map((assignment) => ({
        assignmentId: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        submissionStatus: assignment.submissions[0]?.status ?? null,
      })),
      recentGrades: recentGrades.map((grade) => ({
        assignmentTitle: grade.submission.assignment.title,
        score: grade.score,
        maxScore: grade.maxScore,
        gradedAt: grade.createdAt,
      })),
      masterySnapshot: {
        averageScore,
        skillCount: masteryScores.length,
        belowThreshold: masteryScores.filter((score) => score.score < 0.6).length,
      },
      activeTutorSessions,
      unreadNotifications,
    };
  }

  async getAssignments(
    studentId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    assignments: {
      assignmentId: string;
      title: string;
      dueAt: Date | null;
      maxScore: number;
      classroomId: string;
      submission: {
        id: string;
        status: SubmissionStatus;
        submittedAt: Date | null;
      } | null;
    }[];
    total: number;
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId },
      select: { classroomId: true },
    });
    const classroomIds = enrollments.map((enrollment) => enrollment.classroomId);
    const where = { classroomId: { in: classroomIds }, deletedAt: null };
    const [assignments, total] = await Promise.all([
      this.prisma.assignment.findMany({
        where,
        include: {
          submissions: {
            where: { studentId },
            select: { id: true, status: true, submittedAt: true },
            take: 1,
          },
        },
        orderBy: { dueAt: 'asc' },
        skip: (normalizedPage - 1) * normalizedLimit,
        take: normalizedLimit,
      }),
      this.prisma.assignment.count({ where }),
    ]);

    return {
      assignments: assignments.map((assignment) => ({
        assignmentId: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        maxScore: assignment.maxScore,
        classroomId: assignment.classroomId,
        submission: assignment.submissions[0] ?? null,
      })),
      total,
    };
  }

  async getGrades(studentId: string): Promise<{
    grades: {
      gradeId: string;
      assignmentTitle: string;
      score: number;
      maxScore: number;
      percentage: number;
      classroomId: string;
      gradedAt: Date;
    }[];
    summary: {
      averagePercentage: number;
      highestScore: number;
      totalGraded: number;
    };
  }> {
    const grades = await this.prisma.grade.findMany({
      where: { submission: { studentId } },
      include: {
        submission: {
          include: {
            assignment: { select: { title: true, classroomId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const rows = grades.map((grade) => ({
      gradeId: grade.id,
      assignmentTitle: grade.submission.assignment.title,
      score: grade.score,
      maxScore: grade.maxScore,
      percentage: this.round1(grade.maxScore > 0 ? (grade.score / grade.maxScore) * 100 : 0),
      classroomId: grade.submission.assignment.classroomId,
      gradedAt: grade.createdAt,
    }));
    const averagePercentage = rows.length
      ? this.round1(rows.reduce((sum, grade) => sum + grade.percentage, 0) / rows.length)
      : 0;

    return {
      grades: rows,
      summary: {
        averagePercentage,
        highestScore: rows.length
          ? Math.max(...rows.map((grade) => grade.percentage))
          : 0,
        totalGraded: rows.length,
      },
    };
  }

  async getMastery(studentId: string): Promise<{
    skills: {
      skillTag: string;
      score: number;
      percentage: number;
      trend: 'IMPROVING' | 'DECLINING' | 'STABLE';
      lastUpdated: Date;
    }[];
    summary: {
      averageScore: number;
      skillsAboveThreshold: number;
      skillsBelowThreshold: number;
    };
  }> {
    const scores = await this.prisma.masteryScore.findMany({
      where: { studentId },
      include: {
        history: {
          orderBy: { recordedAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const skills = scores.map((score) => ({
      skillTag: score.skillTag,
      score: score.score,
      percentage: Math.round(score.score * 100),
      trend: this.calculateTrend(score.history.map((history) => history.score)),
      lastUpdated: score.updatedAt,
    }));
    const averageScore = scores.length
      ? this.round1(scores.reduce((sum, score) => sum + score.score, 0) / scores.length)
      : 0;

    return {
      skills,
      summary: {
        averageScore,
        skillsAboveThreshold: scores.filter((score) => score.score >= 0.6).length,
        skillsBelowThreshold: scores.filter((score) => score.score < 0.6).length,
      },
    };
  }

  private calculateTrend(scoresNewestFirst: number[]): 'IMPROVING' | 'DECLINING' | 'STABLE' {
    if (scoresNewestFirst.length < 2) return 'STABLE';
    const slope = this.calculateSlope([...scoresNewestFirst].reverse());
    if (slope > 0.02) return 'IMPROVING';
    if (slope < -0.02) return 'DECLINING';
    return 'STABLE';
  }

  private calculateSlope(scores: number[]): number {
    const n = scores.length;
    const sumX = scores.reduce((sum, _, index) => sum + index, 0);
    const sumY = scores.reduce((sum, score) => sum + score, 0);
    const sumXY = scores.reduce((sum, score, index) => sum + index * score, 0);
    const sumX2 = scores.reduce((sum, _, index) => sum + index * index, 0);
    const denominator = n * sumX2 - sumX * sumX;
    return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
