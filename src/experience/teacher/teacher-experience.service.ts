import { ForbiddenException, Injectable } from '@nestjs/common';
import { AttendanceStatus, Role, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Per-knowledge-component mastery state used in the diagnostic heat-map. */
type DiagnosticState = 'mastered' | 'emerging' | 'notyet' | 'above';

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

  /**
   * Diagnostic heat-map for a classroom: each enrolled student's latest completed
   * diagnostic, collapsed to one mastery state per knowledge component (KC), plus
   * class-level roll-ups by KC and strand. Read-only over existing diagnostic data
   * (no scored AI items involved). "Above level" = missed a harder-than-grade item
   * (an expected miss), tracked separately from a genuine gap.
   */
  async getClassroomDiagnostics(
    classroomId: string,
    user: { userId: string; role: Role },
  ): Promise<{
    classroom: { id: string; name: string };
    totalEnrolled: number;
    studentsAssessed: number;
    kcs: {
      kc: string;
      strand: string;
      mastered: number;
      emerging: number;
      notYet: number;
      aboveLevel: number;
      seenBy: number;
    }[];
    strands: { strand: string; mastered: number; emerging: number; notYet: number }[];
    students: {
      studentId: string;
      name: string;
      grade: string | null;
      theta: number | null;
      se: number | null;
      completedAt: Date | null;
      cells: { kc: string; strand: string; state: DiagnosticState }[];
    }[];
    notYetAssessed: { studentId: string; name: string }[];
  }> {
    const classroom = await this.assertClassroomAccess(classroomId, user);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId },
      select: {
        student: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    const students = enrollments.map((enrollment) => enrollment.student);
    const studentIds = students.map((student) => student.id);
    const nameOf = (student: (typeof students)[number]): string =>
      student.profile
        ? `${student.profile.firstName} ${student.profile.lastName}`
        : student.email;

    const sessions = studentIds.length
      ? await this.prisma.diagnosticSession.findMany({
          where: { userId: { in: studentIds } },
          orderBy: { completedAt: 'desc' },
          select: {
            userId: true,
            grade: true,
            theta: true,
            se: true,
            completedAt: true,
            responses: { select: { kc: true, strand: true, tag: true } },
          },
        })
      : [];

    // findMany is newest-first, so the first session seen per student is the latest.
    const latestByStudent = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (session.userId && !latestByStudent.has(session.userId)) {
        latestByStudent.set(session.userId, session);
      }
    }

    const kcAgg = new Map<
      string,
      {
        kc: string;
        strand: string;
        mastered: number;
        emerging: number;
        notYet: number;
        aboveLevel: number;
        seenBy: number;
      }
    >();
    const strandAgg = new Map<
      string,
      { strand: string; mastered: number; emerging: number; notYet: number }
    >();
    const studentRows: {
      studentId: string;
      name: string;
      grade: string | null;
      theta: number | null;
      se: number | null;
      completedAt: Date | null;
      cells: { kc: string; strand: string; state: DiagnosticState }[];
    }[] = [];
    const notYetAssessed: { studentId: string; name: string }[] = [];

    for (const student of students) {
      const session = latestByStudent.get(student.id);
      if (!session) {
        notYetAssessed.push({ studentId: student.id, name: nameOf(student) });
        continue;
      }
      // Collapse to one state per KC (the strongest signal wins).
      const stateByKc = new Map<string, { strand: string; state: DiagnosticState }>();
      for (const response of session.responses) {
        const state = this.normalizeDiagnosticState(response.tag);
        const existing = stateByKc.get(response.kc);
        if (!existing || this.stateRank(state) > this.stateRank(existing.state)) {
          stateByKc.set(response.kc, { strand: response.strand, state });
        }
      }
      const cells = Array.from(stateByKc.entries()).map(([kc, value]) => ({
        kc,
        strand: value.strand,
        state: value.state,
      }));
      studentRows.push({
        studentId: student.id,
        name: nameOf(student),
        grade: session.grade,
        theta: session.theta,
        se: session.se,
        completedAt: session.completedAt,
        cells,
      });

      for (const cell of cells) {
        const kc = kcAgg.get(cell.kc) ?? {
          kc: cell.kc,
          strand: cell.strand,
          mastered: 0,
          emerging: 0,
          notYet: 0,
          aboveLevel: 0,
          seenBy: 0,
        };
        kc.seenBy += 1;
        if (cell.state === 'mastered') kc.mastered += 1;
        else if (cell.state === 'emerging') kc.emerging += 1;
        else if (cell.state === 'notyet') kc.notYet += 1;
        else kc.aboveLevel += 1;
        kcAgg.set(cell.kc, kc);

        const strand = strandAgg.get(cell.strand) ?? {
          strand: cell.strand,
          mastered: 0,
          emerging: 0,
          notYet: 0,
        };
        if (cell.state === 'mastered') strand.mastered += 1;
        else if (cell.state === 'emerging') strand.emerging += 1;
        else if (cell.state === 'notyet') strand.notYet += 1;
        strandAgg.set(cell.strand, strand);
      }
    }

    // Weakest KCs first — that is what an instructor wants to act on.
    const kcs = Array.from(kcAgg.values()).sort(
      (a, b) => b.notYet - a.notYet || b.emerging - a.emerging || a.kc.localeCompare(b.kc),
    );
    const strands = Array.from(strandAgg.values()).sort((a, b) =>
      a.strand.localeCompare(b.strand),
    );

    return {
      classroom,
      totalEnrolled: students.length,
      studentsAssessed: studentRows.length,
      kcs,
      strands,
      students: studentRows.sort((a, b) => (a.theta ?? 0) - (b.theta ?? 0)),
      notYetAssessed,
    };
  }

  /** Map a stored response tag to a canonical mastery state (defensive about casing/wording). */
  private normalizeDiagnosticState(tag: string): DiagnosticState {
    const t = tag.toLowerCase().replace(/[^a-z]/g, '');
    if (t.includes('master')) return 'mastered';
    if (t.includes('emerg')) return 'emerging';
    if (t.includes('above') || t.includes('stretch') || t.includes('reach')) return 'above';
    return 'notyet';
  }

  /** Ranking so the strongest signal wins when one KC appears more than once. */
  private stateRank(state: DiagnosticState): number {
    switch (state) {
      case 'mastered':
        return 3;
      case 'emerging':
        return 2;
      case 'notyet':
        return 1;
      case 'above':
        return 0;
    }
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
