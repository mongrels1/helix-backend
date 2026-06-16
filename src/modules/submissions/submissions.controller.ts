import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { UpdateSubmissionDto } from './dto/update-submission.dto';
import { SubmissionEntity } from './entities/submission.entity';
import { SubmissionsService } from './submissions.service';

type AuthenticatedUser = { userId: string; role: Role };

@Controller('api/v1/submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  @Roles(Role.STUDENT)
  async create(
    @Body() dto: CreateSubmissionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: SubmissionEntity }> {
    const submission = await this.submissionsService.create(
      dto,
      currentUser.userId,
      currentUser.role,
    );
    return { success: true, data: submission };
  }

  @Get()
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.STUDENT)
  async findAll(
    @Query('assignmentId') assignmentId: string | undefined,
    @Query('studentId') studentId: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{
    success: true;
    data: SubmissionEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.submissionsService.findAll(
      { assignmentId, studentId },
      page,
      limit,
      currentUser,
    );
    return { success: true, ...result };
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: SubmissionEntity }> {
    const submission = await this.submissionsService.findById(id, currentUser);
    return { success: true, data: submission };
  }

  @Patch(':id')
  @Roles(Role.STUDENT)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSubmissionDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: SubmissionEntity }> {
    const submission = await this.submissionsService.update(
      id,
      dto,
      currentUser.userId,
    );
    return { success: true, data: submission };
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Roles(Role.STUDENT)
  async submit(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: SubmissionEntity }> {
    const submission = await this.submissionsService.submit(
      id,
      currentUser.userId,
    );
    return { success: true, data: submission };
  }
}
