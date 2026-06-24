import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { InstructorContent, Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { GenerateCourseContentDto } from './dto/generate-course-content.dto';
import { GenerateFeedbackDto } from './dto/generate-feedback.dto';
import { GenerateInsightDto } from './dto/generate-insight.dto';
import { GenerateRubricDto } from './dto/generate-rubric.dto';
import { GenerateWarmUpDto } from './dto/generate-warmup.dto';
import { InstructorAssistantService } from './instructor-assistant.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/instructor')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class InstructorAssistantController {
  constructor(
    private readonly instructorAssistantService: InstructorAssistantService,
  ) {}

  @Post('course-content')
  async generateCourseContent(
    @Body() dto: GenerateCourseContentDto,
    @CurrentUser() _user: AuthenticatedUser,
  ): Promise<{
    success: true;
    data: { lessonContent: string; quizContent: string };
  }> {
    const data =
      await this.instructorAssistantService.generateCourseContent(dto);
    return { success: true, data };
  }

  @Post('insights')
  async generateInsight(
    @Body() dto: GenerateInsightDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: InstructorContent }> {
    const data = await this.instructorAssistantService.generateInsight({
      ...dto,
      teacherId: user.userId,
    });
    return { success: true, data };
  }

  @Post('warmups')
  async generateWarmUp(
    @Body() dto: GenerateWarmUpDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: InstructorContent }> {
    const data = await this.instructorAssistantService.generateWarmUp({
      ...dto,
      teacherId: user.userId,
    });
    return { success: true, data };
  }

  @Post('rubrics')
  async generateRubric(
    @Body() dto: GenerateRubricDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: InstructorContent }> {
    const data = await this.instructorAssistantService.generateRubric({
      ...dto,
      teacherId: user.userId,
    });
    return { success: true, data };
  }

  @Post('feedback')
  async generateFeedback(
    @Body() dto: GenerateFeedbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: InstructorContent }> {
    const data = await this.instructorAssistantService.generateFeedback({
      ...dto,
      teacherId: user.userId,
    });
    return { success: true, data };
  }

  @Get('content')
  async getContent(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: InstructorContent[] }> {
    const data = await this.instructorAssistantService.getContentForTeacher(
      user.userId,
    );
    return { success: true, data };
  }

  @Patch('content/:id/dismiss')
  async dismissContent(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: InstructorContent }> {
    const data = await this.instructorAssistantService.dismissContent(
      id,
      user.userId,
    );
    return { success: true, data };
  }
}
