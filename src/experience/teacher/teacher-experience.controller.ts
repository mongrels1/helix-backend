import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { TeacherExperienceService } from './teacher-experience.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/experience/teacher')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class TeacherExperienceController {
  constructor(private readonly teacherExperienceService: TeacherExperienceService) {}

  @Get('dashboard')
  async dashboard(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: Awaited<ReturnType<TeacherExperienceService['getDashboard']>> }> {
    const data = await this.teacherExperienceService.getDashboard(user.userId);
    return { success: true, data };
  }

  @Get('classroom/:classroomId/overview')
  async classroomOverview(
    @Param('classroomId') classroomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: Awaited<ReturnType<TeacherExperienceService['getClassroomOverview']>> }> {
    const data = await this.teacherExperienceService.getClassroomOverview(classroomId, user);
    return { success: true, data };
  }

  @Get('classroom/:classroomId/at-risk')
  async atRisk(
    @Param('classroomId') classroomId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: Awaited<ReturnType<TeacherExperienceService['getAtRisk']>> }> {
    const data = await this.teacherExperienceService.getAtRisk(classroomId, user);
    return { success: true, data };
  }

  @Get('grading-queue')
  async gradingQueue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('classroomId') classroomId?: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<TeacherExperienceService['getGradingQueue']>> }> {
    const data = await this.teacherExperienceService.getGradingQueue(user.userId, classroomId);
    return { success: true, data };
  }
}
