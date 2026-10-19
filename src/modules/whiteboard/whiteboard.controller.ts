import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { WhiteboardGateway } from './whiteboard.gateway';
import { WhiteboardService } from './whiteboard.service';

type Requester = { userId: string; role: string; orgId?: string };

@Controller('api/v1/whiteboard')
export class WhiteboardController {
  constructor(
    private readonly service: WhiteboardService,
    private readonly gateway: WhiteboardGateway,
  ) {}

  /** Tutor starts (or resumes) the live session for a classroom. */
  @Post('sessions')
  @Roles(Role.TEACHER)
  async start(
    @CurrentUser() user: Requester,
    @Body()
    body: { classroomId?: string; title?: string; question?: unknown; questions?: Record<string, unknown> },
  ) {
    if (typeof body?.classroomId !== 'string' || body.classroomId.length > 64) {
      throw new BadRequestException('classroomId is required');
    }
    const questions =
      body.questions && typeof body.questions === 'object' && !Array.isArray(body.questions)
        ? Object.fromEntries(Object.entries(body.questions).slice(0, 30))
        : undefined;
    const data = await this.service.startSession(user.userId, {
      classroomId: body.classroomId,
      title: typeof body.title === 'string' ? body.title : undefined,
      question: body.question,
      questions,
    });
    return { success: true, data };
  }

  /** A student's running sessions (the "Join live session" banner). */
  @Get('active')
  @Roles(Role.STUDENT)
  async active(@CurrentUser() user: Requester) {
    return { success: true, data: await this.service.activeForStudent(user.userId) };
  }

  /** Past and current sessions for a classroom (tutor review list). */
  @Get('classrooms/:classroomId/sessions')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async list(@CurrentUser() user: Requester, @Param('classroomId') classroomId: string) {
    return { success: true, data: await this.service.listForClassroom(classroomId, user) };
  }

  /** Read a session with the boards this user may see (used for review after it ends). */
  @Get('sessions/:id')
  async read(@CurrentUser() user: Requester, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.service.readForUser(id, user) };
  }

  @Post('sessions/:id/end')
  @Roles(Role.TEACHER)
  async end(@CurrentUser() user: Requester, @Param('id', ParseUUIDPipe) id: string) {
    const data = await this.service.endSession(id, user.userId);
    await this.gateway.sessionEnded(id, data);
    return { success: true, data };
  }

  /** Published question-bank items, to drop onto a board without retyping. */
  @Get('questions')
  @Roles(Role.TEACHER)
  async questions(@Query('grade') grade?: string, @Query('q') q?: string) {
    const g = grade ? Number.parseInt(grade, 10) : undefined;
    const data = await this.service.searchQuestions({
      grade: g && g >= 1 && g <= 12 ? g : undefined,
      text: typeof q === 'string' && q.trim() ? q.trim().slice(0, 100) : undefined,
    });
    return { success: true, data };
  }
}
