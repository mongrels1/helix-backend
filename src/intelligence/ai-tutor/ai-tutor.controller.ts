import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role, TutorMessage, TutorSession } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { MeteredGuard } from '@common/guards/metered.guard';
import { Meter } from '@common/decorators/meter.decorator';
import { UsageService } from '@modules/usage/usage.service';
import { SendMessageDto } from './dto/send-message.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { TutorSessionWithMessages } from './ai-tutor.repository';
import { AITutorService } from './ai-tutor.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/tutor')
@UseGuards(MeteredGuard)
export class AITutorController {
  constructor(
    private readonly aiTutorService: AITutorService,
    private readonly usageMeter: UsageService,
  ) {}

  @Post('sessions')
  @Roles(Role.STUDENT)
  async startSession(
    @Body() dto: StartSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: TutorSession }> {
    const data = await this.aiTutorService.startSession(
      user.userId,
      dto.assignmentId,
      dto.topic,
    );
    return { success: true, data };
  }

  @Get('sessions')
  @Roles(Role.STUDENT, Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getSessions(
    @Query('studentId') studentId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: TutorSession[] }> {
    const targetStudentId = user.role === Role.STUDENT ? user.userId : studentId;
    const data = targetStudentId
      ? await this.aiTutorService.getSessionsForStudent(targetStudentId)
      : [];
    return { success: true, data };
  }

  @Get('usage')
  @Roles(Role.SUPER_ADMIN)
  async usage(): Promise<{ success: true; data: Awaited<ReturnType<AITutorService['getUsageReport']>> }> {
    return { success: true, data: await this.aiTutorService.getUsageReport() };
  }

  @Get('sessions/:id')
  @Roles(Role.STUDENT, Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: TutorSessionWithMessages }> {
    const data = await this.aiTutorService.getSession(
      id,
      user.userId,
      user.role,
    );
    return { success: true, data };
  }

  /**
   * One tutor question. This is the metered action: the reply is produced
   * first and only then charged, so a failed call never costs a student one of
   * their three.
   */
  @Post('sessions/:id/messages')
  @Roles(Role.STUDENT)
  @Meter('TUTOR')
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: TutorMessage }> {
    const data = await this.aiTutorService.sendMessage(
      id,
      dto.content,
      user.userId,
    );
    await this.usageMeter.consume(user.userId, 'TUTOR');
    return { success: true, data };
  }

  @Patch('sessions/:id/end')
  @Roles(Role.STUDENT)
  async endSession(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: TutorSession }> {
    const data = await this.aiTutorService.endSession(id, user.userId);
    return { success: true, data };
  }
}
