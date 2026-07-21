import { Injectable } from '@nestjs/common';
import { AttendanceRecord, PresenceDay } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceEntryDto } from './dto/attendance-entry.dto';

// Credit at most this many seconds per heartbeat, so a long gap between pings
// (tab closed for a while, then reopened) can't inflate active time.
const MAX_CREDIT_SECONDS = 90;

export interface EngagementRow {
  studentId: string;
  activeSeconds: number;
  firstSeenAt: Date;
}

@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async bulkUpsert(
    classroomId: string,
    date: Date,
    entries: AttendanceEntryDto[],
    recordedById: string,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.attendanceRecord.upsert({
          where: {
            classroomId_studentId_date: {
              classroomId,
              studentId: entry.studentId,
              date,
            },
          },
          create: {
            classroomId,
            studentId: entry.studentId,
            date,
            status: entry.status,
            note: entry.note,
            recordedById,
          },
          update: {
            status: entry.status,
            note: entry.note,
            recordedById,
          },
        }),
      ),
    );
  }

  async findByClassroomAndDate(
    classroomId: string,
    date: Date,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { classroomId, date },
      orderBy: { studentId: 'asc' },
    });
  }

  async findByStudent(
    studentId: string,
    page: number,
    limit: number,
  ): Promise<[AttendanceRecord[], number]> {
    const skip = (page - 1) * limit;
    const where = { studentId };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return [records, total];
  }

  async findRecentByStudent(
    studentId: string,
    classroomId: string,
    limit: number,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { studentId, classroomId },
      take: limit,
      orderBy: { date: 'desc' },
    });
  }

  // Record a heartbeat: create the day's row on first sight, otherwise credit
  // the (capped) elapsed time since the last ping to active seconds.
  async upsertPresence(
    studentId: string,
    date: Date,
    now: Date,
  ): Promise<PresenceDay> {
    const existing = await this.prisma.presenceDay.findUnique({
      where: { studentId_date: { studentId, date } },
    });
    if (!existing) {
      return this.prisma.presenceDay.create({
        data: { studentId, date, firstSeenAt: now, lastSeenAt: now, activeSeconds: 0 },
      });
    }
    const gapSeconds = Math.max(0, Math.round((now.getTime() - existing.lastSeenAt.getTime()) / 1000));
    const credit = Math.min(gapSeconds, MAX_CREDIT_SECONDS);
    return this.prisma.presenceDay.update({
      where: { studentId_date: { studentId, date } },
      data: { lastSeenAt: now, activeSeconds: existing.activeSeconds + credit },
    });
  }

  // Engagement for every enrolled student in a classroom on a given day.
  async engagementForClassroom(
    classroomId: string,
    date: Date,
  ): Promise<EngagementRow[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId },
      select: { studentId: true },
    });
    const studentIds = enrollments.map((enrollment) => enrollment.studentId);
    if (studentIds.length === 0) return [];
    const rows = await this.prisma.presenceDay.findMany({
      where: { studentId: { in: studentIds }, date },
    });
    return rows.map((row) => ({
      studentId: row.studentId,
      activeSeconds: row.activeSeconds,
      firstSeenAt: row.firstSeenAt,
    }));
  }
}
