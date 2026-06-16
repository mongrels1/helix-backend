import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { MasteryScoreEntity } from './entities/mastery-score.entity';
import { MasteryEngineService } from './mastery-engine.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/mastery')
export class MasteryEngineController {
  constructor(private readonly masteryEngineService: MasteryEngineService) {}

  @Get('student/:studentId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.STUDENT)
  async getStudentMastery(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: MasteryScoreEntity[] }> {
    this.assertCanViewStudent(user, studentId);
    const data = await this.masteryEngineService.getMasteryForStudent(studentId);
    return { success: true, data };
  }

  @Get('student/:studentId/skill/:skillTag')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.STUDENT)
  async getSkillMastery(
    @Param('studentId') studentId: string,
    @Param('skillTag') skillTag: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    success: true;
    data: { score: MasteryScoreEntity; history: unknown[] };
  }> {
    this.assertCanViewStudent(user, studentId);
    const data = await this.masteryEngineService.getMasteryDetail(
      studentId,
      skillTag,
    );
    if (!data) throw new NotFoundException('Mastery score not found');
    return { success: true, data };
  }

  @Get('classroom/:classroomId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getClassroomMastery(
    @Param('classroomId') classroomId: string,
  ): Promise<{ success: true; data: MasteryScoreEntity[] }> {
    const data = await this.masteryEngineService.getClassroomOverview(classroomId);
    return { success: true, data };
  }

  private assertCanViewStudent(user: AuthenticatedUser, studentId: string): void {
    if (user.role !== Role.STUDENT || user.userId === studentId) return;
    throw new ForbiddenException('Students can only view their own mastery');
  }
}
