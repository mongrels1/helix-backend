import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** A schedule row flattened with everything the engine needs to send: the
 *  student's timezone/phone and any linked parents' phones. */
export interface ScheduleContext {
  scheduleId: string;
  studentId: string;
  dayOfWeek: number;
  studyTime: string;
  timezone: string | null;
  studentPhone: string | null;
  studentFirstName: string | null;
  parents: Array<{ phone: string | null; firstName: string | null }>;
}

@Injectable()
export class RemindersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every active student's schedule rows, joined to student + parent contacts. */
  async findAllScheduleContexts(): Promise<ScheduleContext[]> {
    const rows = await this.prisma.studySchedule.findMany({
      where: { student: { deletedAt: null } },
      select: {
        id: true,
        studentId: true,
        dayOfWeek: true,
        studyTime: true,
        student: {
          select: {
            profile: { select: { firstName: true, phone: true, timezone: true } },
            studentLinks: {
              select: {
                parent: { select: { profile: { select: { firstName: true, phone: true } } } },
              },
            },
          },
        },
      },
    });

    return rows.map((r) => ({
      scheduleId: r.id,
      studentId: r.studentId,
      dayOfWeek: r.dayOfWeek,
      studyTime: r.studyTime,
      timezone: r.student.profile?.timezone ?? null,
      studentPhone: r.student.profile?.phone ?? null,
      studentFirstName: r.student.profile?.firstName ?? null,
      parents: r.student.studentLinks.map((link) => ({
        phone: link.parent.profile?.phone ?? null,
        firstName: link.parent.profile?.firstName ?? null,
      })),
    }));
  }

  /**
   * Claim a reminder by inserting its row BEFORE sending. Returns the new row id
   * if this call won the claim, or null if it already exists (unique collision) —
   * that's the idempotency guard against overlapping/restarted cron runs.
   */
  async claimReminder(input: {
    studentId: string;
    scheduleId: string;
    recipient: string;
    phone: string;
    scheduledFor: Date;
  }): Promise<string | null> {
    try {
      const row = await this.prisma.studyReminder.create({
        data: { ...input, deliveryStatus: 'sending' },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return null; // already claimed for this (schedule, occurrence, recipient)
      }
      throw err;
    }
  }

  async markReminder(id: string, deliveryStatus: string, ghlRef?: string | null): Promise<void> {
    await this.prisma.studyReminder.update({
      where: { id },
      data: { deliveryStatus, ghlRef: ghlRef ?? null, sentAt: new Date() },
    });
  }
}
