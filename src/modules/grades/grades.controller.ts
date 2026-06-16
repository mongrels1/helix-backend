import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { GradeEntity } from './entities/grade.entity';
import { GradesService } from './grades.service';

type AuthenticatedUser = { userId: string; role: Role };

@Controller('api/v1')
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  @Post('grades')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async create(
    @Body() dto: CreateGradeDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: GradeEntity }> {
    const grade = await this.gradesService.create(dto, currentUser.userId);
    return { success: true, data: grade };
  }

  @Get('grades/submission/:submissionId')
  async findBySubmission(
    @Param('submissionId') submissionId: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: GradeEntity }> {
    const grade = await this.gradesService.findBySubmission(
      submissionId,
      currentUser,
    );
    return { success: true, data: grade };
  }

  @Get('grades/:id')
  async findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: GradeEntity }> {
    const grade = await this.gradesService.findById(id, currentUser);
    return { success: true, data: grade };
  }

  @Patch('grades/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGradeDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: GradeEntity }> {
    const grade = await this.gradesService.update(id, dto, currentUser.userId);
    return { success: true, data: grade };
  }
}
