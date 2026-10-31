import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LESSON_PLAN_USAGE_KIND,
  isSelfServeTeacher,
  lessonPlanWeekKey,
  weeklyLessonPlanAllowance,
} from '../../common/teacher/teacher-signup';

/**
 * The weekly lesson-plan allowance for self-serve teachers (1 a week by default).
 *
 * Free teacher signup is open to a whole district, and every generated plan is
 * real AI spend, so those accounts are counted. Admin-created teachers, org
 * admins and the owner are never counted and never limited.
 *
 * A plan is charged only after it has been generated, so a failed or timed-out
 * generation never costs a teacher their week's plan.
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

  /** Throws 403 when a self-serve teacher has used this week's plans. */
  async assertCanGenerate(userId: string): Promise<void> {
    if (!(await this.isCounted(userId))) return;
    const allowance = weeklyLessonPlanAllowance();
    const row = await this.prisma.dailyUsage.findUnique({
      where: {
        userId_day_kind: { userId, day: lessonPlanWeekKey(), kind: LESSON_PLAN_USAGE_KIND },
      },
      select: { count: true },
    });
    if ((row?.count ?? 0) >= allowance) {
      throw new ForbiddenException({
        error: {
          code: 'lesson_plan_weekly_limit',
          message:
            allowance === 1
              ? "You've used this week's free lesson plan. Your next one is available Monday."
              : `You've used this week's ${allowance} free lesson plans. More are available Monday.`,
          allowance,
          used: row?.count ?? 0,
        },
      });
    }
  }

  /** Counts one generated plan against a self-serve teacher's week. */
  async record(userId: string): Promise<void> {
    if (!(await this.isCounted(userId))) return;
    const day = lessonPlanWeekKey();
    await this.prisma.dailyUsage.upsert({
      where: { userId_day_kind: { userId, day, kind: LESSON_PLAN_USAGE_KIND } },
      create: { userId, day, kind: LESSON_PLAN_USAGE_KIND, count: 1 },
      update: { count: { increment: 1 } },
    });
  }
}
