import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsString } from 'class-validator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { ParentExperienceService } from './parent-experience.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

class LinkParentStudentDto {
  @IsString()
  parentId!: string;

  @IsString()
  studentId!: string;
}

@Controller('api/v1/experience/parent')
@Roles(Role.PARENT)
export class ParentExperienceController {
  constructor(private readonly parentExperienceService: ParentExperienceService) {}

  @Post('link')
  @HttpCode(200)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async link(
    @Body() body: LinkParentStudentDto,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['linkParentToStudent']>> }> {
    const data = await this.parentExperienceService.linkParentToStudent(
      body.parentId,
      body.studentId,
    );
    return { success: true, data };
  }

  @Get('children')
  async children(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildren']>> }> {
    const data = await this.parentExperienceService.getChildren(user.userId);
    return { success: true, data };
  }

  @Get('child/:studentId/attendance')
  async attendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildAttendance']>> }> {
    const data = await this.parentExperienceService.getChildAttendance(user.userId, studentId);
    return { success: true, data };
  }

  @Get('child/:studentId/grades')
  async grades(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildGrades']>> }> {
    const data = await this.parentExperienceService.getChildGrades(user.userId, studentId);
    return { success: true, data };
  }

  @Get('child/:studentId/alerts')
  async alerts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildAlerts']>> }> {
    const data = await this.parentExperienceService.getChildAlerts(user.userId, studentId);
    return { success: true, data };
  }
}
