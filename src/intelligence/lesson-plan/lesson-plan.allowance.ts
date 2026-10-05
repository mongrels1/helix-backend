import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LESSON_PLAN_USAGE_KIND,
  dailyLessonPlanAllowance,
  isSelfServeTeacher,
  lessonPlanDayKey,
} from '../../common/teacher/teacher-signup';

/**
 * The daily lesson-plan allowance for self-serve teachers.
 *
 * Free teacher signup is open to a whole district, and every generated plan is
 * real AI spend, so those accounts are counted. Admin-created teachers, org
 * admins and the owner are never counted and never limited.
 *
 * A plan is charged only after it has been generated, so a failed or timed-out
 * generation never costs a teacher one of their day's plans.
 */
@Injectable()
export class LessonPlanAllowanceService {
  constructor(private readonly prisma: PrismaService) {}

  private async isCounted(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, plan: true },
    });
    return isSelfServeTeacher(user?.role, user?.plan);
  }

  /** Throws 403 when a self-serve teacher has used today's plans. */
  async assertCanGenerate(userId: string): Promise<void> {
    if (!(await this.isCounted(userId))) return;
    const allowance = dailyLessonPlanAllowance();
    const row = await this.prisma.dailyUsage.findUnique({
      where: {
        userId_day_kind: { userId, day: lessonPlanDayKey(), kind: LESSON_PLAN_USAGE_KIND },
      },
      select: { count: true },
    });
    if ((row?.count ?? 0) >= allowance) {
      throw new ForbiddenException({
        error: {
          code: 'lesson_plan_daily_limit',
          message: `You have generated today's ${allowance} lesson plans. The count resets at midnight Eastern.`,
          allowance,
          used: row?.count ?? 0,
        },
      });
    }
  }

  /** Counts one generated plan against a self-serve teacher's day. */
  async record(userId: string): Promise<void> {
    if (!(await this.isCounted(userId))) return;
    const day = lessonPlanDayKey();
    await this.prisma.dailyUsage.upsert({
      where: { userId_day_kind: { userId, day, kind: LESSON_PLAN_USAGE_KIND } },
      create: { userId, day, kind: LESSON_PLAN_USAGE_KIND, count: 1 },
      update: { count: { increment: 1 } },
    });
  }
}
