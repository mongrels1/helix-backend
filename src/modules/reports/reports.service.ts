import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { accessibleClassroomWhere, assertClassroomAccess, type ClassroomNeed } from '@common/classroom-access/classroom-access';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '@modules/email/email.service';
import { effectiveGrade } from '@common/grade/grade';
import { DEFAULT_GOAL_MINUTES, PracticeBand, practiceBand, schoolWeek, SchoolWeek } from './report-week';

export type ReportCaller = { userId: string; role: Role | string };

/** One line of the "Work completed" list (rendered per language on the client). */
export type WorkLogEntry =
  | { date: string; kind: 'practice'; standard: string | null; count: number; correct: number }
  | { date: string; kind: 'assignment'; title: string; score: number | null; maxScore: number | null }
  | { date: string; kind: 'help'; count: number }
  | { date: string; kind: 'diagnostic'; items: number };

const LOW_OUTPUT_MIN_MINUTES = 45;
const LOW_OUTPUT_PER_HOUR = 2;
const schoolDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const WINDOW_DAYS = 7;
const IDLE_GAP_MS = 15 * 60 * 1000; // a gap longer than this starts a new session
const MIN_SESSION_MS = 60 * 1000; // floor: a burst of activity counts as >= 1 minute

export interface StudentWeeklyReport {
  studentId: string;
  /** First name (what the parent email greets). */
  name: string;
  fullName: string;
  /** "K" or "1"–"12": own grade, else the class's. */
  grade: string | null;
  classrooms: { id: string; name: string }[];
  windowStart: Date;
  windowEnd: Date;
  /** The school week (Mon–Sun, school time) this report covers. */
  week: { start: string; end: string };
  /**
   * Measured practice time: minutes on learning pages with the page on screen
   * and the student active (PresenceTracker → PresenceDay). `sessions` = sign-ins.
   */
  timeOnApp: { minutes: number; activeDays: number; sessions: number };
  daily: { date: string; minutes: number }[];
  goal: { minutes: number; pct: number; band: PracticeBand };
  lastSignInAt: Date | null;
  /** "Ask for help": the student's own questions this week (teacher view; not emailed). */
  help: { questions: number; recent: string[] };
  assignments: {
    id: string;
    title: string;
    dueAt: Date | null;
    submittedAt: Date | null;
    score: number | null;
    maxScore: number | null;
  }[];
  /**
   * Work actually saved this week, next to the minutes. Minutes alone can be
   * padded (a hand on the mouse keeps the timer going); saved work can't.
   * `lowOutput` = 45+ minutes but under 2 pieces of work per hour: a prompt
   * for the teacher to check (lesson reading saves nothing), never shown to families.
   */
  work: {
    practiceAnswered: number;
    practiceCorrect: number;
    assignmentsTurnedIn: number;
    helpQuestions: number;
    diagnosticsTaken: number;
    items: number;
    perHour: number;
    lowOutput: boolean;
    log: WorkLogEntry[];
  };
  practice: { answered: number; correct: number; accuracyPct: number };
  tutoring: { sessions: number; messages: number };
  diagnostics: { taken: number };
  mastery: { tracked: number; mastered: number; masteredThisWeek: number; belowThreshold: number };
  grades: { averagePercentage: number; gradedThisWeek: number };
  attendance: { present: number; absent: number; ratePct: number } | null;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private async collectActivityTimestamps(studentId: string, since: Date): Promise<Date[]> {
    const [tutorMsgs, practice, diagnostics] = await Promise.all([
      this.prisma.tutorMessage.findMany({
        where: { createdAt: { gte: since }, session: { studentId } },
        select: { createdAt: true },
      }),
      this.prisma.practiceResponse.findMany({
        where: { userId: studentId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.diagnosticSession.findMany({
        where: { userId: studentId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
    ]);
    return [
      ...tutorMsgs.map((r) => r.createdAt),
      ...practice.map((r) => r.createdAt),
      ...diagnostics.map((r) => r.createdAt),
    ];
  }

  private sessionize(timestamps: Date[]): { minutes: number; sessions: number; activeDays: number } {
    if (timestamps.length === 0) return { minutes: 0, sessions: 0, activeDays: 0 };
    const ms = timestamps.map((d) => d.getTime()).sort((a, b) => a - b);
    const days = new Set<string>();
    let totalMs = 0;
    let sessions = 0;
    let sessionStart = ms[0];
    let prev = ms[0];
    days.add(new Date(ms[0]).toISOString().slice(0, 10));
    for (let i = 1; i < ms.length; i++) {
      const t = ms[i];
      days.add(new Date(t).toISOString().slice(0, 10));
      if (t - prev > IDLE_GAP_MS) {
        totalMs += Math.max(prev - sessionStart, MIN_SESSION_MS);
        sessions += 1;
        sessionStart = t;
      }
      prev = t;
    }
    totalMs += Math.max(prev - sessionStart, MIN_SESSION_MS);
    sessions += 1;
    return { minutes: Math.round(totalMs / 60000), sessions, activeDays: days.size };
  }

  async computeTimeOnApp(studentId: string, since: Date) {
    const ts = await this.collectActivityTimestamps(studentId, since);
    return this.sessionize(ts);
  }

  /** The class's weekly goal, else the first goal set on any of the student's classes, else 180. */
  private defaultGoal(): number {
    const raw = Number(this.config.get<string>('PRACTICE_GOAL_MINUTES'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GOAL_MINUTES;
  }

  /**
   * THE weekly report for one student: used by the Sunday parent email, the
   * teacher's student page, single and batch printouts, and the student's own
   * counter. One builder, so every screen shows the same numbers.
   */
  async buildStudentReport(
    studentId: string,
    opts: { week?: string | null; goalMinutes?: number | null; schoolWeek?: SchoolWeek } = {},
  ): Promise<StudentWeeklyReport> {
    const wk = opts.schoolWeek ?? schoolWeek(opts.week);
    const windowStart = wk.startUtc;
    const windowEnd = wk.endUtc;
    const windowEndOrNow = new Date(Math.min(windowEnd.getTime(), Date.now()));
    const dayStart = new Date(`${wk.start}T00:00:00.000Z`);
    const dayEnd = new Date(`${wk.end}T00:00:00.000Z`);
    const inWindow = { gte: windowStart, lt: windowEnd };

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true, grade: true } },
        enrollments: {
          where: { classroom: { deletedAt: null } },
          select: { classroom: { select: { id: true, name: true, practiceGoalMinutes: true, gradeLevel: true } } },
        },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const classrooms = student.enrollments.map((e) => e.classroom);
    const classroomIds = classrooms.map((c) => c.id);
    const [
      presence,
      signIns,
      lastSignIn,
      practice,
      tutorSessions,
      tutorMessages,
      helpQuestions,
      diagnostics,
      mastery,
      masteredThisWeek,
      grades,
      attendance,
      dueAssignments,
      weekSubmissions,
    ] = await Promise.all([
      this.prisma.presenceDay.findMany({
        where: { studentId, date: { gte: dayStart, lte: dayEnd } },
        select: { date: true, activeSeconds: true },
      }),
      this.prisma.loginEvent.count({ where: { userId: studentId, loginAt: inWindow } }),
      this.prisma.loginEvent.findFirst({ where: { userId: studentId }, orderBy: { loginAt: 'desc' }, select: { loginAt: true } }),
      this.prisma.practiceResponse.findMany({
        where: { userId: studentId, createdAt: inWindow },
        select: { correct: true, createdAt: true, standard: true },
      }),
      this.prisma.tutorSession.count({ where: { studentId, createdAt: inWindow } }),
      this.prisma.tutorMessage.count({
        where: { createdAt: inWindow, session: { studentId } },
      }),
      this.prisma.tutorMessage.findMany({
        where: { createdAt: inWindow, role: 'STUDENT', session: { studentId } },
        orderBy: { createdAt: 'desc' },
        select: { content: true, createdAt: true },
        take: 500,
      }),
      this.prisma.diagnosticSession.findMany({
        where: { userId: studentId, createdAt: inWindow },
        select: { createdAt: true, itemsAsked: true },
      }),
      this.prisma.masteryScore.findMany({
        where: { studentId },
        select: { status: true, score: true },
      }),
      this.prisma.masteryScore.count({
        where: { studentId, masteredAt: inWindow },
      }),
      this.prisma.grade.findMany({
        where: { submission: { studentId }, createdAt: { lt: windowEnd } },
        select: { score: true, maxScore: true, createdAt: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { studentId, date: { gte: dayStart, lte: dayEnd } },
        select: { status: true },
      }),
      classroomIds.length
        ? this.prisma.assignment.findMany({
            where: { classroomId: { in: classroomIds }, deletedAt: null, dueAt: inWindow },
            select: { id: true, title: true, dueAt: true, maxScore: true },
          })
        : Promise.resolve([] as { id: string; title: string; dueAt: Date | null; maxScore: number }[]),
      this.prisma.submission.findMany({
        where: { studentId, OR: [{ submittedAt: inWindow }, { assignment: { dueAt: inWindow } }] },
        select: {
          assignmentId: true,
          submittedAt: true,
          assignment: { select: { title: true, dueAt: true, maxScore: true } },
          grade: { select: { score: true, maxScore: true } },
        },
      }),
    ]);

    const byDay = new Map(presence.map((p) => [p.date.toISOString().slice(0, 10), p.activeSeconds]));
    const daily = wk.days.map((date) => ({ date, minutes: Math.round((byDay.get(date) ?? 0) / 60) }));
    const minutes = Math.round(presence.reduce((a, p) => a + p.activeSeconds, 0) / 60);
    const activeDays = presence.filter((p) => p.activeSeconds >= 60).length;
    const goalMinutes =
      opts.goalMinutes ?? classrooms.find((c) => c.practiceGoalMinutes)?.practiceGoalMinutes ?? this.defaultGoal();

    // ── Work completed, by school day ──
    const log: WorkLogEntry[] = [];
    const practiceGroups = new Map<string, { date: string; standard: string | null; count: number; correct: number }>();
    for (const p of practice) {
      const date = schoolDate(p.createdAt);
      const k = `${date}|${p.standard ?? ''}`;
      const g = practiceGroups.get(k) ?? { date, standard: p.standard ?? null, count: 0, correct: 0 };
      g.count += 1;
      if (p.correct) g.correct += 1;
      practiceGroups.set(k, g);
    }
    for (const g of practiceGroups.values()) log.push({ kind: 'practice', ...g });
    const turnedIn = weekSubmissions.filter((sub) => sub.submittedAt && sub.submittedAt >= windowStart && sub.submittedAt < windowEnd);
    for (const sub of turnedIn) {
      log.push({
        date: schoolDate(sub.submittedAt as Date), kind: 'assignment', title: sub.assignment.title,
        score: sub.grade?.score ?? null, maxScore: sub.grade?.maxScore ?? sub.assignment.maxScore,
      });
    }
    const helpByDay = new Map<string, number>();
    for (const m of helpQuestions) helpByDay.set(schoolDate(m.createdAt), (helpByDay.get(schoolDate(m.createdAt)) ?? 0) + 1);
    for (const [date, count] of helpByDay) log.push({ date, kind: 'help', count });
    for (const d of diagnostics) log.push({ date: schoolDate(d.createdAt), kind: 'diagnostic', items: d.itemsAsked });
    const kindOrder = { assignment: 0, practice: 1, diagnostic: 2, help: 3 } as const;
    log.sort((a, b) => a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind]);
    const items = practice.length + turnedIn.length + helpQuestions.length + diagnostics.length;
    const perHour = minutes > 0 ? Math.round((items / (minutes / 60)) * 10) / 10 : 0;
    const work: StudentWeeklyReport['work'] = {
      practiceAnswered: practice.length,
      practiceCorrect: practice.filter((p) => p.correct).length,
      assignmentsTurnedIn: turnedIn.length,
      helpQuestions: helpQuestions.length,
      diagnosticsTaken: diagnostics.length,
      items,
      perHour,
      lowOutput: minutes >= LOW_OUTPUT_MIN_MINUTES && perHour < LOW_OUTPUT_PER_HOUR,
      log,
    };

    const subByAssignment = new Map(weekSubmissions.map((sub) => [sub.assignmentId, sub]));
    const assignmentRows = new Map<string, StudentWeeklyReport['assignments'][number]>();
    for (const a of dueAssignments) {
      const sub = subByAssignment.get(a.id);
      assignmentRows.set(a.id, {
        id: a.id, title: a.title, dueAt: a.dueAt, submittedAt: sub?.submittedAt ?? null,
        score: sub?.grade?.score ?? null, maxScore: sub?.grade?.maxScore ?? a.maxScore,
      });
    }
    for (const sub of weekSubmissions) {
      if (assignmentRows.has(sub.assignmentId)) continue;
      assignmentRows.set(sub.assignmentId, {
        id: sub.assignmentId, title: sub.assignment.title, dueAt: sub.assignment.dueAt, submittedAt: sub.submittedAt,
        score: sub.grade?.score ?? null, maxScore: sub.grade?.maxScore ?? sub.assignment.maxScore,
      });
    }
    const answered = practice.length;
    const correct = practice.filter((p) => p.correct).length;
    const tracked = mastery.length;
    const mastered = mastery.filter((m) => m.status === 'MASTERED').length;
    const belowThreshold = mastery.filter((m) => m.score < 0.6).length;
    const gradedThisWeek = grades.filter((g) => g.createdAt >= windowStart).length;
    void windowEndOrNow;
    const gradePcts = grades.map((g) => (g.maxScore > 0 ? (g.score / g.maxScore) * 100 : 0));
    const averagePercentage = gradePcts.length
      ? Math.round((gradePcts.reduce((a, b) => a + b, 0) / gradePcts.length) * 10) / 10
      : 0;
    let attendanceBlock: StudentWeeklyReport['attendance'] = null;
    if (attendance.length > 0) {
      const present = attendance.filter((a) => a.status === 'PRESENT').length;
      const absent = attendance.filter((a) => a.status === 'ABSENT').length;
      attendanceBlock = {
        present,
        absent,
        ratePct: Math.round((present / attendance.length) * 1000) / 10,
      };
    }
    const name =
      student.profile?.firstName?.trim() || student.email.split('@')[0] || 'your student';
    const fullName = `${student.profile?.firstName ?? ''} ${student.profile?.lastName ?? ''}`.trim() || name;
    return {
      studentId,
      name,
      fullName,
      grade: effectiveGrade(student.profile?.grade, classrooms.map((c) => c.gradeLevel)),
      classrooms: classrooms.map((c) => ({ id: c.id, name: c.name })),
      windowStart,
      windowEnd,
      week: { start: wk.start, end: wk.end },
      timeOnApp: { minutes, activeDays, sessions: signIns },
      daily,
      goal: {
        minutes: goalMinutes,
        pct: goalMinutes > 0 ? Math.min(100, Math.round((minutes / goalMinutes) * 100)) : 0,
        band: practiceBand(minutes, goalMinutes, signIns > 0 || !!lastSignIn),
      },
      lastSignInAt: lastSignIn?.loginAt ?? null,
      help: { questions: helpQuestions.length, recent: helpQuestions.slice(0, 5).map((m) => m.content.slice(0, 300)) },
      work,
      assignments: [...assignmentRows.values()].sort(
        (a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0),
      ),
      practice: {
        answered,
        correct,
        accuracyPct: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
      },
      tutoring: { sessions: tutorSessions, messages: tutorMessages },
      diagnostics: { taken: diagnostics.length },
      mastery: { tracked, mastered, masteredThisWeek, belowThreshold },
      grades: { averagePercentage, gradedThisWeek },
      attendance: attendanceBlock,
    };
  }
  async previewForUser(
    userId: string,
  ): Promise<{ recipient: string; reports: StudentWeeklyReport[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        parentLinks: { select: { studentId: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const studentIds =
      user.role === Role.PARENT ? user.parentLinks.map((l) => l.studentId) : [user.id];
    const reports = await Promise.all(studentIds.map((id) => this.buildStudentReport(id)));
    return { recipient: user.email, reports };
  }
  async sendReportForUser(
    userId: string,
    trigger: 'CRON' | 'MANUAL' = 'MANUAL',
    force = false,
  ): Promise<{ sent: boolean; recipient: string; students: number; reason?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        profile: { select: { firstName: true } },
        parentLinks: { select: { studentId: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    // Idempotency: never send a recipient more than one weekly report per week,
    // even if the Sunday cron double-fires (extra replica / external trigger).
    // A manual send can override with force=true.
    if (!force && (await this.alreadySentThisWeek(user.id))) {
      await this.prisma.weeklyReportRun.create({
        data: {
          recipientId: user.id,
          recipientEmail: user.email,
          studentsCount: 0,
          minutesTotal: 0,
          status: 'SKIPPED',
          trigger,
          detail: 'duplicate suppressed (already sent this week)',
        },
      });
      this.logger.log(`Weekly report skipped for ${user.email} (already sent this week)`);
      return { sent: false, recipient: user.email, students: 0, reason: 'already sent this week' };
    }
    const studentIds =
      user.role === Role.PARENT ? user.parentLinks.map((l) => l.studentId) : [user.id];
    if (studentIds.length === 0) {
      await this.prisma.weeklyReportRun.create({
        data: { recipientId: user.id, recipientEmail: user.email, studentsCount: 0, minutesTotal: 0, status: 'SKIPPED', trigger, detail: 'no linked students' },
      });
      return { sent: false, recipient: user.email, students: 0, reason: 'no linked students' };
    }
    const reports = await Promise.all(studentIds.map((id) => this.buildStudentReport(id)));
    const recipientName = user.profile?.firstName?.trim() || user.email.split('@')[0];
    const html = this.renderHtml(reports, recipientName);
    const text = this.renderText(reports, recipientName);
    const minutesTotal = reports.reduce((a, r) => a + r.timeOnApp.minutes, 0);
    try {
      await this.email.sendWeeklyReport(user.email, 'Your EdKairos weekly report', html, text);
      await this.prisma.weeklyReportRun.create({
        data: { recipientId: user.id, recipientEmail: user.email, studentsCount: reports.length, minutesTotal, status: 'SENT', trigger },
      });
      this.logger.log(`Weekly report sent to ${user.email} (${reports.length} student[s])`);
      return { sent: true, recipient: user.email, students: reports.length };
    } catch (e) {
      await this.prisma.weeklyReportRun.create({
        data: { recipientId: user.id, recipientEmail: user.email, studentsCount: reports.length, minutesTotal, status: 'FAILED', trigger, detail: (e as Error).message },
      });
      throw e;
    }
  }
  private async alreadySentThisWeek(recipientId: string): Promise<boolean> {
    // Weekly reports run every 7 days; suppress a second SENT within a 6-day
    // window (safely under the cadence) so a duplicate trigger can't email twice.
    const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    const existing = await this.prisma.weeklyReportRun.findFirst({
      where: { recipientId, status: 'SENT', createdAt: { gte: since } },
      select: { id: true },
    });
    return Boolean(existing);
  }

  async getRecentRuns(limit = 100) {
    return this.prisma.weeklyReportRun.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
  async runWeeklyBatch(trigger: 'CRON' | 'MANUAL' = 'CRON', force = false): Promise<{ processed: number; sent: number }> {
    const candidates = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { role: Role.PARENT, parentLinks: { some: {} } },
          { role: Role.STUDENT, studentLinks: { none: {} } },
        ],
      },
      select: { id: true, email: true, planStatus: true },
    });
    const recipients = candidates.filter((u) => this.isActivePlan(u.planStatus));
    let sent = 0;
    for (const r of recipients) {
      try {
        const res = await this.sendReportForUser(r.id, trigger, force);
        if (res.sent) sent += 1;
      } catch (e) {
        this.logger.error(`Weekly report failed for ${r.email}: ${(e as Error).message}`);
      }
    }
    this.logger.log(`Weekly batch complete: ${sent}/${recipients.length} sent`);
    return { processed: recipients.length, sent };
  }
  private isActivePlan(status: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    const inactive = [
      'canceled',
      'cancelled',
      'inactive',
      'past_due',
      'unpaid',
      'paused',
      'incomplete',
      'incomplete_expired',
      'none',
    ];
    return !inactive.includes(s);
  }
  private fmtMinutes(min: number): string {
    if (min <= 0) return '0 min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }
  // ── Who may see which report ──────────────────────────────────────────────

  /** Student: self. Parent: linked child. Teacher: a student in one of their classes. Admins: as below. */
  async assertCanViewStudent(caller: ReportCaller, studentId: string): Promise<void> {
    if (caller.role === Role.SUPER_ADMIN) return;
    if (caller.role === Role.STUDENT && caller.userId === studentId) return;
    if (caller.role === Role.PARENT) {
      const link = await this.prisma.parentStudentLink.findFirst({ where: { parentId: caller.userId, studentId }, select: { id: true } });
      if (link) return;
    }
    if (caller.role === Role.TEACHER || caller.role === Role.ORG_ADMIN) {
      // In a class they own or that is shared with them.
      const enrolled = await this.prisma.enrollment.findFirst({
        where: { studentId, classroom: { deletedAt: null, ...accessibleClassroomWhere(caller.userId) } },
        select: { id: true },
      });
      if (enrolled) return;
    }
    if (caller.role === Role.ORG_ADMIN) {
      const shared = await this.prisma.membership.findFirst({
        where: { userId: studentId, organization: { memberships: { some: { userId: caller.userId, role: Role.ORG_ADMIN } } } },
        select: { id: true },
      });
      if (shared) return;
    }
    throw new ForbiddenException('You do not have access to this student');
  }

  private async ownedClassroom(classroomId: string, caller: ReportCaller, need: ClassroomNeed = 'view') {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, deletedAt: null },
      select: { id: true, name: true, teacherId: true, practiceGoalMinutes: true, organizationId: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    await assertClassroomAccess(this.prisma, classroom, caller, need);
    return classroom;
  }

  async reportForStudent(caller: ReportCaller, studentId: string, week?: string, classroomId?: string) {
    await this.assertCanViewStudent(caller, studentId);
    let goalMinutes: number | null = null;
    if (classroomId) {
      const c = await this.prisma.classroom.findFirst({ where: { id: classroomId }, select: { practiceGoalMinutes: true } });
      goalMinutes = c?.practiceGoalMinutes ?? null;
    }
    const report = await this.buildStudentReport(studentId, { week, goalMinutes });
    // Parents and students see the same report as the email: no help-question text.
    if (caller.role === Role.PARENT || caller.role === Role.STUDENT) {
      report.help.recent = [];
      report.work.lowOutput = false; // a check for the teacher, not a label for families
    }
    return report;
  }

  /** Every enrolled student's report for one class and week (Progress tab + batch print). */
  async reportsForClassroom(caller: ReportCaller, classroomId: string, week?: string) {
    const classroom = await this.ownedClassroom(classroomId, caller);
    const wk = schoolWeek(week);
    const goalMinutes = classroom.practiceGoalMinutes ?? this.defaultGoal();
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId, student: { deletedAt: null } },
      select: { studentId: true },
    });
    const reports: StudentWeeklyReport[] = [];
    for (let i = 0; i < enrollments.length; i += 8) {
      const chunk = enrollments.slice(i, i + 8);
      reports.push(...(await Promise.all(chunk.map((e) => this.buildStudentReport(e.studentId, { schoolWeek: wk, goalMinutes })))));
    }
    reports.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return {
      classroom: { id: classroom.id, name: classroom.name, goalMinutes, goalIsDefault: classroom.practiceGoalMinutes == null },
      week: { start: wk.start, end: wk.end },
      reports,
    };
  }

  async setClassroomGoal(caller: ReportCaller, classroomId: string, minutes: number | null) {
    await this.ownedClassroom(classroomId, caller, 'teach');
    const value = minutes == null ? null : Math.round(minutes);
    if (value != null && (value < 15 || value > 1200)) {
      throw new BadRequestException('Weekly goal must be between 15 minutes and 20 hours.');
    }
    await this.prisma.classroom.update({ where: { id: classroomId }, data: { practiceGoalMinutes: value } });
    return { goalMinutes: value ?? this.defaultGoal(), goalIsDefault: value == null };
  }

  renderHtml(reports: StudentWeeklyReport[], recipientName: string): string {
    const url = this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
    const blocks = reports
      .map((r) => {
        const att = r.attendance
          ? `<tr><td>Attendance</td><td>${r.attendance.present} present / ${r.attendance.absent} absent (${r.attendance.ratePct}%)</td></tr>`
          : '';
        const timeCell = r.timeOnApp.minutes
          ? `<strong>${this.fmtMinutes(r.timeOnApp.minutes)}</strong> of the ${this.fmtMinutes(r.goal.minutes)} weekly goal &middot; on ${r.timeOnApp.activeDays} day(s)`
          : 'No practice time recorded this week';
        return `
      <h3 style="margin:24px 0 8px;color:#111827;">${this.escape(r.name)}</h3>
      <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:14px;color:#111827;">
        <tr style="background:#ecfdf5;"><td style="width:130px;"><strong>Practice time</strong></td><td>${timeCell}</td></tr>
        <tr><td>Work completed</td><td>${r.work.assignmentsTurnedIn} assignment(s) turned in &middot; ${r.work.practiceAnswered} practice question(s) &middot; ${r.work.helpQuestions} help question(s)</td></tr>
        <tr><td>Practice</td><td>${r.practice.answered} answered &middot; ${r.practice.accuracyPct}% correct</td></tr>
        <tr style="background:#f9fafb;"><td>Tutoring</td><td>${r.tutoring.sessions} session(s) &middot; ${r.tutoring.messages} messages</td></tr>
        <tr><td>Diagnostics</td><td>${r.diagnostics.taken} taken</td></tr>
        <tr style="background:#f9fafb;"><td>Mastery</td><td>${r.mastery.mastered}/${r.mastery.tracked} skills mastered &middot; ${r.mastery.masteredThisWeek} new this week &middot; ${r.mastery.belowThreshold} need work</td></tr>
        <tr><td>Grades</td><td>${r.grades.gradedThisWeek} graded this week &middot; ${r.grades.averagePercentage}% average</td></tr>
        ${att}
      </table>`;
      })
      .join('');
    return `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:640px;margin:0 auto;">
        <h2 style="color:#059669;">Your EdKairos weekly report</h2>
        <p>Hi ${this.escape(recipientName)}, here's how the past week went.</p>
        ${blocks}
        <p style="margin-top:24px;"><a href="${url}" style="background:#059669;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Open EdKairos</a></p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">You're receiving this because you have an active EdKairos subscription. Practice time is measured while your child is working on lessons, assignments, practice or help in EdKairos with the page on screen; it pauses after 2 minutes without activity.</p>
      </div>`;
  }
  renderText(reports: StudentWeeklyReport[], recipientName: string): string {
    const lines: string[] = [`Hi ${recipientName}, your EdKairos weekly report:`, ''];
    for (const r of reports) {
      lines.push(`== ${r.name} ==`);
      lines.push(
        `Practice time: ${this.fmtMinutes(r.timeOnApp.minutes)} of the ${this.fmtMinutes(r.goal.minutes)} weekly goal, on ${r.timeOnApp.activeDays} day(s)`,
      );
      lines.push(`Work completed: ${r.work.assignmentsTurnedIn} assignment(s) turned in, ${r.work.practiceAnswered} practice question(s), ${r.work.helpQuestions} help question(s)`);
      lines.push(`Practice: ${r.practice.answered} answered, ${r.practice.accuracyPct}% correct`);
      lines.push(`Tutoring: ${r.tutoring.sessions} sessions, ${r.tutoring.messages} messages`);
      lines.push(`Diagnostics: ${r.diagnostics.taken} taken`);
      lines.push(
        `Mastery: ${r.mastery.mastered}/${r.mastery.tracked} mastered, ${r.mastery.masteredThisWeek} new this week, ${r.mastery.belowThreshold} need work`,
      );
      lines.push(`Grades: ${r.grades.gradedThisWeek} graded this week, ${r.grades.averagePercentage}% average`);
      if (r.attendance) {
        lines.push(
          `Attendance: ${r.attendance.present} present / ${r.attendance.absent} absent (${r.attendance.ratePct}%)`,
        );
      }
      lines.push('');
    }
    return lines.join('\n');
  }
  private escape(v: string): string {
    return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
