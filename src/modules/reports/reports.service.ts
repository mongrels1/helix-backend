import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '@modules/email/email.service';

const WINDOW_DAYS = 7;
const IDLE_GAP_MS = 15 * 60 * 1000; // a gap longer than this starts a new session
const MIN_SESSION_MS = 60 * 1000; // floor: a burst of activity counts as >= 1 minute

export interface StudentWeeklyReport {
  studentId: string;
  name: string;
  windowStart: Date;
  windowEnd: Date;
  timeOnApp: { minutes: number; activeDays: number; sessions: number };
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

  async buildStudentReport(studentId: string): Promise<StudentWeeklyReport> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    const [
      time,
      practice,
      tutorSessions,
      tutorMessages,
      diagnostics,
      mastery,
      masteredThisWeek,
      grades,
      attendance,
    ] = await Promise.all([
      this.computeTimeOnApp(studentId, windowStart),
      this.prisma.practiceResponse.findMany({
        where: { userId: studentId, createdAt: { gte: windowStart } },
        select: { correct: true },
      }),
      this.prisma.tutorSession.count({ where: { studentId, createdAt: { gte: windowStart } } }),
      this.prisma.tutorMessage.count({
        where: { createdAt: { gte: windowStart }, session: { studentId } },
      }),
      this.prisma.diagnosticSession.count({
        where: { userId: studentId, createdAt: { gte: windowStart } },
      }),
      this.prisma.masteryScore.findMany({
        where: { studentId },
        select: { status: true, score: true },
      }),
      this.prisma.masteryScore.count({
        where: { studentId, masteredAt: { gte: windowStart } },
      }),
      this.prisma.grade.findMany({
        where: { submission: { studentId } },
        select: { score: true, maxScore: true, createdAt: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { studentId, date: { gte: windowStart } },
        select: { status: true },
      }),
    ]);
    const answered = practice.length;
    const correct = practice.filter((p) => p.correct).length;
    const tracked = mastery.length;
    const mastered = mastery.filter((m) => m.status === 'MASTERED').length;
    const belowThreshold = mastery.filter((m) => m.score < 0.6).length;
    const gradedThisWeek = grades.filter((g) => g.createdAt >= windowStart).length;
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
    return {
      studentId,
      name,
      windowStart,
      windowEnd,
      timeOnApp: {
        minutes: time.minutes,
        activeDays: time.activeDays,
        sessions: time.sessions,
      },
      practice: {
        answered,
        correct,
        accuracyPct: answered ? Math.round((correct / answered) * 1000) / 10 : 0,
      },
      tutoring: { sessions: tutorSessions, messages: tutorMessages },
      diagnostics: { taken: diagnostics },
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
  async getRecentRuns(limit = 100) {
    return this.prisma.weeklyReportRun.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
  async runWeeklyBatch(trigger: 'CRON' | 'MANUAL' = 'CRON'): Promise<{ processed: number; sent: number }> {
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
        const res = await this.sendReportForUser(r.id, trigger);
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
  renderHtml(reports: StudentWeeklyReport[], recipientName: string): string {
    const url = this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
    const blocks = reports
      .map((r) => {
        const att = r.attendance
          ? `<tr><td>Attendance</td><td>${r.attendance.present} present / ${r.attendance.absent} absent (${r.attendance.ratePct}%)</td></tr>`
          : '';
        const timeCell = r.timeOnApp.minutes
          ? `<strong>${this.fmtMinutes(r.timeOnApp.minutes)}</strong> across ${r.timeOnApp.activeDays} day(s), ${r.timeOnApp.sessions} session(s)`
          : 'No activity recorded this week';
        return `
      <h3 style="margin:24px 0 8px;color:#111827;">${this.escape(r.name)}</h3>
      <table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;font-size:14px;color:#111827;">
        <tr style="background:#ecfdf5;"><td style="width:130px;"><strong>Time on app</strong></td><td>${timeCell}</td></tr>
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
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">You're receiving this because you have an active EdKairos subscription. Time on app is measured from in-app learning activity (tutoring, practice, and diagnostics).</p>
      </div>`;
  }
  renderText(reports: StudentWeeklyReport[], recipientName: string): string {
    const lines: string[] = [`Hi ${recipientName}, your EdKairos weekly report:`, ''];
    for (const r of reports) {
      lines.push(`== ${r.name} ==`);
      lines.push(
        `Time on app: ${this.fmtMinutes(r.timeOnApp.minutes)} across ${r.timeOnApp.activeDays} day(s), ${r.timeOnApp.sessions} session(s)`,
      );
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
