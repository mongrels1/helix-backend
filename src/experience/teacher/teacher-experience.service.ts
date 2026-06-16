import { ForbiddenException, Injectable } from '@nestjs/common';
import { AttendanceStatus, Role, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeacherExperienceService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(teacherId: string): Promise<{
    classrooms: { id: string; name: string; enrollmentCount: number }[];
    pendingGrades: number;
    upcomingAssignments: {
      id: string;
      title: string;
      dueAt: Date | null;
      classroomId: string;
    }[];
    atRiskCount: number;
    activeNotifications: number;
  }> {
    const classrooms = await this.prisma.classroom.findMany({
      where: { teacherId, deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { enrollments: true } },
      },
    });
    const classroomIds = classrooms.map((classroom) => classroom.id);
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [pendingGrades, upcomingAssignments, absences, activeNotifications] =
      await Promise.all([
        this.prisma.submission.count({
          where: {
            status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
            assignment: { classroomId: { in: classroomIds } },
          },
        }),
        this.prisma.assignment.findMany({
          where: {
            classroomId: { in: classroomIds },
            dueAt: { gte: now, lte: nextWeek },
            deletedAt: null,
          },
          select: { id: true, title: true, dueAt: true, classroomId: true },
          orderBy: { dueAt: 'asc' },
          take: 10,
        }),
        this.prisma.attendanceRecord.groupBy({
          by: ['studentId'],
          where: {
            classroomId: { in: classroomIds },
            status: AttendanceStatus.ABSENT,
          },
          _count: { _all: true },
          having: { studentId: { _count: { gte: 3 } } },
        }),
        this.prisma.notification.count({
          where: {
            userId: teacherId,
            readAt: null,
            deletedAt: null,
          },
        }),
      ]);

    return {
      classrooms: classrooms.map((classroom) => ({
        id: classroom.id,
        name: classroom.name,
        enrollmentCount: classroom._count.enrollments,
      })),
      pendingGrades,
      upcomingAssignments,
      atRiskCount: absences.length,
      activeNotifications,
    };
  }

  async getClassroomOverview(
    classroomId: string,
    user: { userId: string; role: Role },
  ): Promise<{
    classroom: { id: string; name: string };
    enrollmentCount: number;
    attendance: { present: number; absent: number; late: number; rate: number };
    grades: { averageScore: number; gradedCount: number; ungradedCount: number };
    recentSubmissions: {
      id: string;
      studentId: string;
      assignmentId: string;
      status: SubmissionStatus;
      submittedAt: Date | null;
    }[];
  }> {
    const classroom = await this.assertClassroomAccess(classroomId, user);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [enrollmentCount, attendanceRecords, grades, ungradedCount, recentSubmissions] =
      await Promise.all([
        this.prisma.enrollment.count({ where: { classroomId } }),
        this.prisma.attendanceRecord.groupBy({
          by: ['status'],
          where: { classroomId, date: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.grade.findMany({
          where: { submission: { assignment: { classroomId } } },
          select: { score: true, maxScore: true },
        }),
        this.prisma.submission.count({
          where: {
            status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
            assignment: { classroomId },
          },
        }),
        this.prisma.submission.findMany({
          where: { assignment: { classroomId } },
          select: {
            id: true,
            studentId: true,
            assignmentId: true,
            status: true,
            submittedAt: true,
          },
          orderBy: { submittedAt: 'desc' },
          take: 10,
        }),
      ]);

    const present = this.countStatus(attendanceRecords, AttendanceStatus.PRESENT);
    const absent = this.countStatus(attendanceRecords, AttendanceStatus.ABSENT);
    const late = this.countStatus(attendanceRecords, AttendanceStatus.LATE);
    const totalAttendance = present + absent + late;
    const averageScore = this.round1(
      grades.length
        ? grades.reduce(
            (sum, grade) => sum + (grade.maxScore > 0 ? grade.score / grade.maxScore : 0),
            0,
          ) /
            grades.length *
            100
        : 0,
    );

    return {
      classroom: { id: classroom.id, name: classroom.name },
      enrollmentCount,
      attendance: {
        present,
        absent,
        late,
        rate: totalAttendance ? this.round1((present / totalAttendance) * 100) : 0,
      },
      grades: {
        averageScore,
        gradedCount: grades.length,
        ungradedCount,
      },
      recentSubmissions,
    };
  }

  async getAtRisk(
    classroomId: string,
    user: { userId: string; role: Role },
  ): Promise<{
    atRisk: {
      studentId: string;
      attendanceAbsences: number;
      lowestMasteryScore: number | null;
      lowestMasterySkill: string | null;
    }[];
    total: number;
  }> {
    await this.assertClassroomAccess(classroomId, user);
    const [absences, masteryScores] = await Promise.all([
      this.prisma.attendanceRecord.groupBy({
        by: ['studentId'],
        where: { classroomId, status: AttendanceStatus.ABSENT },
        _count: { _all: true },
        having: { studentId: { _count: { gte: 3 } } },
      }),
      this.prisma.masteryScore.findMany({
        where: {
          score: { lt: 0.6 },
          student: { enrollments: { some: { classroomId } } },
        },
        orderBy: { score: 'asc' },
      }),
    ]);

    const riskByStudent = new Map<
      string,
      {
        studentId: string;
        attendanceAbsences: number;
        lowestMasteryScore: number | null;
        lowestMasterySkill: string | null;
      }
    >();
    for (const absence of absences) {
      riskByStudent.set(absence.studentId, {
        studentId: absence.studentId,
        attendanceAbsences: absence._count._all,
        lowestMasteryScore: null,
        lowestMasterySkill: null,
      });
    }
    for (const score of masteryScores) {
      const existing = riskByStudent.get(score.studentId);
      if (!existing || existing.lowestMasteryScore === null || score.score < existing.lowestMasteryScore) {
        riskByStudent.set(score.studentId, {
          studentId: score.studentId,
          attendanceAbsences: existing?.attendanceAbsences ?? 0,
          lowestMasteryScore: score.score,
          lowestMasterySkill: score.skillTag,
        });
      }
    }

    const atRisk = Array.from(riskByStudent.values());
    return { atRisk, total: atRisk.length };
  }

  async getGradingQueue(
    teacherId: string,
    classroomId?: string,
  ): Promise<{
    queue: {
      submissionId: string;
      studentId: string;
      assignmentId: string;
      assignmentTitle: string;
      classroomId: string;
      status: SubmissionStatus;
      submittedAt: Date | null;
    }[];
    total: number;
  }> {
    const classrooms = await this.prisma.classroom.findMany({
      where: { teacherId, deletedAt: null, ...(classroomId ? { id: classroomId } : {}) },
      select: { id: true },
    });
    const classroomIds = classrooms.map((classroom) => classroom.id);
    const submissions = await this.prisma.submission.findMany({
      where: {
        status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] },
        assignment: { classroomId: { in: classroomIds } },
      },
      include: { assignment: { select: { title: true, classroomId: true } } },
      orderBy: { submittedAt: 'asc' },
      take: 50,
    });

    const queue = submissions.map((submission) => ({
      submissionId: submission.id,
      studentId: submission.studentId,
      assignmentId: submission.assignmentId,
      assignmentTitle: submission.assignment.title,
      classroomId: submission.assignment.classroomId,
      status: submission.status,
      submittedAt: submission.submittedAt,
    }));
    return { queue, total: queue.length };
  }

  private async assertClassroomAccess(
    classroomId: string,
    user: { userId: string; role: Role },
  ): Promise<{ id: string; name: string }> {
    const classroom = await this.prisma.classroom.findFirst({
      where: {
        id: classroomId,
        deletedAt: null,
        ...(user.role === Role.TEACHER ? { teacherId: user.userId } : {}),
      },
      select: { id: true, name: true },
    });
    if (!classroom) throw new ForbiddenException('Classroom access denied');
    return classroom;
  }

  private countStatus(
    records: { status: AttendanceStatus; _count: { _all: number } }[],
    status: AttendanceStatus,
  ): number {
    return records.find((record) => record.status === status)?._count._all ?? 0;
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
