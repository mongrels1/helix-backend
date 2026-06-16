import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { StudentExperienceService } from './student-experience.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/experience/student')
@Roles(Role.STUDENT, Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class StudentExperienceController {
  constructor(private readonly studentExperienceService: StudentExperienceService) {}

  @Get('dashboard')
  async dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('studentId') requestedStudentId?: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<StudentExperienceService['getDashboard']>> }> {
    const studentId = this.studentExperienceService.resolveStudentId(requestedStudentId, user);
    const data = await this.studentExperienceService.getDashboard(studentId);
    return { success: true, data };
  }

  @Get('assignments')
  async assignments(
    @CurrentUser() user: AuthenticatedUser,
    @Query('studentId') requestedStudentId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{ success: true; data: Awaited<ReturnType<StudentExperienceService['getAssignments']>> }> {
    const studentId = this.studentExperienceService.resolveStudentId(requestedStudentId, user);
    const data = await this.studentExperienceService.getAssignments(studentId, page, limit);
    return { success: true, data };
  }

  @Get('grades')
  async grades(
    @CurrentUser() user: AuthenticatedUser,
    @Query('studentId') requestedStudentId?: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<StudentExperienceService['getGrades']>> }> {
    const studentId = this.studentExperienceService.resolveStudentId(requestedStudentId, user);
    const data = await this.studentExperienceService.getGrades(studentId);
    return { success: true, data };
  }

  @Get('mastery')
  async mastery(
    @CurrentUser() user: AuthenticatedUser,
    @Query('studentId') requestedStudentId?: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<StudentExperienceService['getMastery']>> }> {
    const studentId = this.studentExperienceService.resolveStudentId(requestedStudentId, user);
    const data = await this.studentExperienceService.getMastery(studentId);
    return { success: true, data };
  }
}
