import { Controller, ForbiddenException, Get, Param, Patch } from '@nestjs/common';
import { PacingRecommendation, Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { PacingEngineService } from './pacing-engine.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/pacing')
export class PacingEngineController {
  constructor(private readonly pacingEngineService: PacingEngineService) {}

  @Get('student/:studentId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.STUDENT)
  async getStudentRecommendations(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: { recommendations: PacingRecommendation[] } }> {
    this.assertCanViewStudent(user, studentId);
    const recommendations =
      await this.pacingEngineService.getRecommendationsForStudent(studentId);
    return { success: true, data: { recommendations } };
  }

  @Get('classroom/:classroomId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getClassroomRecommendations(
    @Param('classroomId') classroomId: string,
  ): Promise<{ success: true; data: { recommendations: PacingRecommendation[] } }> {
    const recommendations =
      await this.pacingEngineService.getRecommendationsForClassroom(classroomId);
    return { success: true, data: { recommendations } };
  }

  @Patch(':id/dismiss')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async dismissRecommendation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: PacingRecommendation }> {
    const data = await this.pacingEngineService.dismissRecommendation(
      id,
      user.userId,
    );
    return { success: true, data };
  }

  private assertCanViewStudent(user: AuthenticatedUser, studentId: string): void {
    if (user.role !== Role.STUDENT || user.userId === studentId) return;
    throw new ForbiddenException('Students can only view their own pacing');
  }
}
