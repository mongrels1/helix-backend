import { Injectable } from '@nestjs/common';
import { nextOccurrenceUtc } from '../reminders/reminder-time';
import {
  EngagementSummary,
  enumerateOccurrences,
  scoreOccurrences,
  summarize,
} from './engagement';
import {
  LoginLogRow,
  ReminderLogRow,
  StudyAdminRepository,
} from './study-admin.repository';

export interface OverviewRow {
  studentId: string;
  name: string;
  email: string;
  grade: string | null;
  timezone: string | null;
  phone: string | null;
  daysPerWeek: number;
  nextSessionAt: string | null;
  lastLoginAt: string | null;
  engagement: EngagementSummary;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class StudyAdminService {
  constructor(private readonly repo: StudyAdminRepository) {}

  /** Don't score sessions from before the plan existed: clamp the window start up
   *  to the earliest schedule row's creation time. (Re-saving a plan resets this,
   *  so adherence reflects the plan as it currently stands.) */
  private clampFrom(schedules: Array<{ createdAt: Date }>, from: Date): Date {
    if (schedules.length === 0) return from;
    const earliest = Math.min(...schedules.map((s) => s.createdAt.getTime()));
    return new Date(Math.max(from.getTime(), earliest));
  }

  /** One row per student with a plan: schedule size, next session, last login, and
   *  the engagement rollup (on-time/late/missed, adherence, streak) over `days`.
   *  Sorted most-at-risk first (lowest adherence) so staff see who's slipping. */
  async overview(days = 14, now: Date = new Date()): Promise<{ days: number; rows: OverviewRow[] }> {
    const window = Math.min(Math.max(Math.floor(days) || 14, 1), 90);
    const from = new Date(now.getTime() - window * DAY_MS);
    const students = await this.repo.studentsWithSchedules();
    const ids = students.map((s) => s.id);
    const [logins, lastLogins] = await Promise.all([
      this.repo.loginsSince(ids, from),
      this.repo.lastLoginMap(ids),
    ]);

    const rows: OverviewRow[] = students.map((s) => {
      const scheduleRows = s.schedules;
      const loginMs = logins.get(s.id) ?? [];
      // Only score sessions on/after the plan was created, so a brand-new plan
      // doesn't show pre-plan slots as "missed".
      const occ = enumerateOccurrences(scheduleRows, s.timezone, this.clampFrom(scheduleRows, from), now);
      const scored = scoreOccurrences(occ, loginMs, now);
      const engagement = summarize(scored);

      const next = scheduleRows
        .map((r) => nextOccurrenceUtc(r.dayOfWeek, r.studyTime, s.timezone ?? '', now))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      return {
        studentId: s.id,
        name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || s.email,
        email: s.email,
        grade: s.grade,
        timezone: s.timezone,
        phone: s.phone,
        daysPerWeek: scheduleRows.length,
        nextSessionAt: next ? next.toISOString() : null,
        lastLoginAt: lastLogins.get(s.id)?.toISOString() ?? null,
        engagement,
      };
    });

    // Most-at-risk first: lowest adherence, nulls (nothing scored yet) last.
    rows.sort((a, b) => {
      const av = a.engagement.adherencePct;
      const bv = b.engagement.adherencePct;
      if (av === null && bv === null) return a.name.localeCompare(b.name);
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv;
    });

    return { days: window, rows };
  }

  /** Per-student occurrence timeline (each session's status) + the rollup. */
  async studentEngagement(
    studentId: string,
    days = 30,
    now: Date = new Date(),
  ): Promise<{
    days: number;
    summary: EngagementSummary;
    occurrences: Array<{ scheduledFor: string; dayOfWeek: number; studyTime: string; status: string }>;
  }> {
    const window = Math.min(Math.max(Math.floor(days) || 30, 1), 90);
    const from = new Date(now.getTime() - window * DAY_MS);
    const students = await this.repo.studentsWithSchedules();
    const student = students.find((s) => s.id === studentId);
    if (!student) {
      return { days: window, summary: summarize([]), occurrences: [] };
    }
    const loginsMap = await this.repo.loginsSince([studentId], from);
    const loginMs = loginsMap.get(studentId) ?? [];
    const scored = scoreOccurrences(
      enumerateOccurrences(student.schedules, student.timezone, this.clampFrom(student.schedules, from), now),
      loginMs,
      now,
    );
    return {
      days: window,
      summary: summarize(scored),
      occurrences: scored.map((o) => ({
        scheduledFor: o.scheduledFor.toISOString(),
        dayOfWeek: o.dayOfWeek,
        studyTime: o.studyTime,
        status: o.status,
      })),
    };
  }

  async reminderLog(args: {
    studentId?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }): Promise<{ rows: ReminderLogRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(args.page, 1);
    const limit = Math.min(Math.max(args.limit, 1), 200);
    const { rows, total } = await this.repo.reminderLog({
      studentId: args.studentId,
      from: args.from,
      to: args.to,
      skip: (page - 1) * limit,
      take: limit,
    });
    return { rows, total, page, limit };
  }

  async loginLog(args: {
    studentId?: string;
    from?: Date;
    to?: Date;
    page: number;
    limit: number;
  }): Promise<{ rows: LoginLogRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(args.page, 1);
    const limit = Math.min(Math.max(args.limit, 1), 200);
    const { rows, total } = await this.repo.loginLog({
      studentId: args.studentId,
      from: args.from,
      to: args.to,
      skip: (page - 1) * limit,
      take: limit,
    });
    return { rows, total, page, limit };
  }
}
