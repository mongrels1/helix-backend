import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { ReportsService } from './reports.service';
import { SetGoalDto } from './dto/set-goal.dto';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('weekly/me/preview')
  @HttpCode(200)
  async previewMine(@CurrentUser() user: AuthenticatedUser): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['previewForUser']>>;
  }> {
    return { success: true, data: await this.reports.previewForUser(user.userId) };
  }

  @Post('weekly/me')
  @HttpCode(200)
  async sendMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('force') force?: string,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['sendReportForUser']>>;
  }> {
    return {
      success: true,
      data: await this.reports.sendReportForUser(user.userId, 'MANUAL', force === 'true'),
    };
  }

  /** One student's weekly report (week = any date in the week, YYYY-MM-DD). */
  @Get('weekly/students/:studentId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.PARENT, Role.STUDENT)
  async student(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
    @Query('week') week?: string,
    @Query('classroomId') classroomId?: string,
  ) {
    return { success: true, data: await this.reports.reportForStudent(user, studentId, week, classroomId) };
  }

  /** The signed-in student's own week (the counter on their Assignments page). */
  @Get('weekly/me/week')
  @Roles(Role.STUDENT)
  async myWeek(@CurrentUser() user: AuthenticatedUser) {
    const r = await this.reports.reportForStudent(user, user.userId);
    return { success: true, data: { week: r.week, minutes: r.timeOnApp.minutes, goal: r.goal, daily: r.daily } };
  }

  /** Every student's weekly report for one class (Progress tab + batch print). */
  @Get('weekly/classrooms/:classroomId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async classroom(
    @CurrentUser() user: AuthenticatedUser,
    @Param('classroomId') classroomId: string,
    @Query('week') week?: string,
  ) {
    return { success: true, data: await this.reports.reportsForClassroom(user, classroomId, week) };
  }

  /** Set (or clear, with null) a class's weekly practice goal in minutes. */
  @Post('classrooms/:classroomId/goal')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(200)
  async goal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('classroomId') classroomId: string,
    @Body() body: SetGoalDto,
  ) {
    return { success: true, data: await this.reports.setClassroomGoal(user, classroomId, body.minutes ?? null) };
  }

  @Post('weekly/run')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  async runBatch(@Query('force') force?: string): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['runWeeklyBatch']>>;
  }> {
    return { success: true, data: await this.reports.runWeeklyBatch('MANUAL', force === 'true') };
  }

  @Get('runs')
  @Roles(Role.SUPER_ADMIN)
  async runs(): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['getRecentRuns']>>;
  }> {
    return { success: true, data: await this.reports.getRecentRuns() };
  }
}
