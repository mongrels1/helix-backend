import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface StudentWithSchedule {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  grade: string | null;
  timezone: string | null;
  phone: string | null;
  schedules: Array<{ scheduleId: string; dayOfWeek: number; studyTime: string; createdAt: Date }>;
}

export interface ReminderLogRow {
  id: string;
  studentId: string;
  studentName: string;
  recipient: string;
  phone: string;
  scheduledFor: Date;
  sentAt: Date;
  deliveryStatus: string;
  ghlRef: string | null;
}

export interface LoginLogRow {
  id: string;
  userId: string;
  userName: string;
  email: string;
  loginAt: Date;
}

interface LogFilter {
  studentId?: string;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

function nameOf(p?: { firstName: string | null; lastName: string | null } | null): string {
  return `${p?.firstName ?? ''} ${p?.lastName ?? ''}`.trim();
}

@Injectable()
export class StudyAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every active student who has a study plan, with their plan + contact/locale. */
  async studentsWithSchedules(): Promise<StudentWithSchedule[]> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, studySchedules: { some: {} } },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true, grade: true, timezone: true, phone: true } },
        studySchedules: { select: { id: true, dayOfWeek: true, studyTime: true, createdAt: true } },
      },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.profile?.firstName ?? null,
      lastName: u.profile?.lastName ?? null,
      grade: u.profile?.grade ?? null,
      timezone: u.profile?.timezone ?? null,
      phone: u.profile?.phone ?? null,
      schedules: u.studySchedules.map((s) => ({
        scheduleId: s.id,
        dayOfWeek: s.dayOfWeek,
        studyTime: s.studyTime,
        createdAt: s.createdAt,
      })),
    }));
  }

  /** Login timestamps (ms) since `since`, grouped by studentId. */
  async loginsSince(studentIds: string[], since: Date): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    if (studentIds.length === 0) return map;
    const rows = await this.prisma.loginEvent.findMany({
      where: { userId: { in: studentIds }, loginAt: { gte: since } },
      select: { userId: true, loginAt: true },
    });
    for (const r of rows) {
      const arr = map.get(r.userId) ?? [];
      arr.push(r.loginAt.getTime());
      map.set(r.userId, arr);
    }
    return map;
  }

  /** Most-recent login per student (all-time), for the "last seen" column. */
  async lastLoginMap(studentIds: string[]): Promise<Map<string, Date>> {
    const map = new Map<string, Date>();
    if (studentIds.length === 0) return map;
    const grouped = await this.prisma.loginEvent.groupBy({
      by: ['userId'],
      where: { userId: { in: studentIds } },
      _max: { loginAt: true },
    });
    for (const g of grouped) {
      if (g._max.loginAt) map.set(g.userId, g._max.loginAt);
    }
    return map;
  }

  async reminderLog(filter: LogFilter): Promise<{ rows: ReminderLogRow[]; total: number }> {
    const where = {
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.from || filter.to
        ? { sentAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.studyReminder.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        select: {
          id: true,
          studentId: true,
          recipient: true,
          phone: true,
          scheduledFor: true,
          sentAt: true,
          deliveryStatus: true,
          ghlRef: true,
          student: { select: { profile: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.studyReminder.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        studentName: nameOf(r.student.profile),
        recipient: r.recipient,
        phone: r.phone,
        scheduledFor: r.scheduledFor,
        sentAt: r.sentAt,
        deliveryStatus: r.deliveryStatus,
        ghlRef: r.ghlRef,
      })),
    };
  }

  async loginLog(filter: LogFilter): Promise<{ rows: LoginLogRow[]; total: number }> {
    const where = {
      ...(filter.studentId ? { userId: filter.studentId } : {}),
      ...(filter.from || filter.to
        ? { loginAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loginEvent.findMany({
        where,
        orderBy: { loginAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        select: {
          id: true,
          userId: true,
          loginAt: true,
          user: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
        },
      }),
      this.prisma.loginEvent.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: nameOf(r.user.profile),
        email: r.user.email,
        loginAt: r.loginAt,
      })),
    };
  }
}
