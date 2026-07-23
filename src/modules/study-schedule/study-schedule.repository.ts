import { Injectable } from '@nestjs/common';
import { StudySchedule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleDayInput } from './dto/set-schedule.dto';

@Injectable()
export class StudyScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByStudent(studentId: string): Promise<StudySchedule[]> {
    return this.prisma.studySchedule.findMany({
      where: { studentId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  /** Contact/locale the reminder engine needs, read from the profile. */
  async getContact(
    studentId: string,
  ): Promise<{ phone: string | null; timezone: string | null }> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: studentId },
      select: { phone: true, timezone: true },
    });
    return { phone: profile?.phone ?? null, timezone: profile?.timezone ?? null };
  }

  /**
   * Replace the student's whole weekly plan atomically: persist timezone (+phone
   * if given) on the profile, then delete-and-recreate the schedule rows. Done in
   * one transaction so a partial write can never leave a half-updated plan.
   */
  async replaceSchedule(
    studentId: string,
    timezone: string,
    phone: string | undefined,
    days: ScheduleDayInput[],
  ): Promise<StudySchedule[]> {
    await this.prisma.$transaction([
      this.prisma.profile.updateMany({
        where: { userId: studentId },
        data: {
          timezone,
          ...(phone !== undefined ? { phone: phone.trim() || null } : {}),
        },
      }),
      this.prisma.studySchedule.deleteMany({ where: { studentId } }),
      this.prisma.studySchedule.createMany({
        data: days.map((d) => ({
          studentId,
          dayOfWeek: d.dayOfWeek,
          studyTime: d.studyTime,
        })),
      }),
    ]);
    return this.findByStudent(studentId);
  }
}
