import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role, Rubric } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { CreateRubricDto } from './dto/create-rubric.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { AssignmentEntity } from './entities/assignment.entity';

@Controller('api/v1')
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Post('assignments')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async create(
    @Body() dto: CreateAssignmentDto,
  ): Promise<{ success: true; data: AssignmentEntity }> {
    const assignment = await this.assignmentsService.create(dto);
    return { success: true, data: assignment };
  }

  @Get('assignments')
  async findAll(
    @Query('classroomId') classroomId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: AssignmentEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.assignmentsService.findAll(
      classroomId,
      page,
      limit,
    );
    return { success: true, ...result };
  }

  @Get('assignments/:id')
  async findById(
    @Param('id') id: string,
  ): Promise<{ success: true; data: AssignmentEntity }> {
    const assignment = await this.assignmentsService.findById(id);
    return { success: true, data: assignment };
  }

  @Patch('assignments/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAssignmentDto,
  ): Promise<{ success: true; data: AssignmentEntity }> {
    const assignment = await this.assignmentsService.update(id, dto);
    return { success: true, data: assignment };
  }

  @Delete('assignments/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async remove(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.assignmentsService.remove(id);
    return { success: true, data: null };
  }

  @Post('assignments/:id/rubric')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async createRubric(
    @Param('id') id: string,
    @Body() dto: CreateRubricDto,
  ): Promise<{ success: true; data: Rubric }> {
    const rubric = await this.assignmentsService.createRubric(id, dto);
    return { success: true, data: rubric };
  }

  @Patch('rubrics/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async updateRubric(
    @Param('id') id: string,
    @Body() dto: CreateRubricDto,
  ): Promise<{ success: true; data: Rubric }> {
    const rubric = await this.assignmentsService.updateRubric(id, dto);
    return { success: true, data: rubric };
  }

  @Delete('rubrics/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async deleteRubric(
    @Param('id') id: string,
  ): Promise<{ success: true; data: null }> {
    await this.assignmentsService.deleteRubric(id);
    return { success: true, data: null };
  }
}
