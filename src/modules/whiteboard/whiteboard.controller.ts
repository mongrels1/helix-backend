import {
  BadRequestException,
  Body,
  HttpException,
  HttpStatus,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { WhiteboardGateway } from './whiteboard.gateway';
import { RateLimiter } from './whiteboard.logic';
import { WhiteboardService } from './whiteboard.service';

type Requester = { userId: string; role: string; orgId?: string };

@Controller('api/v1/whiteboard')
export class WhiteboardController {
  private readonly joinLimits = new Map<string, RateLimiter>();

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
    // No classroomId = a quick session students join with the code.
    if (body?.classroomId !== undefined && (typeof body.classroomId !== 'string' || body.classroomId.length > 64)) {
      throw new BadRequestException('Bad classroom');
    }
    const questions =
      body.questions && typeof body.questions === 'object' && !Array.isArray(body.questions)
        ? Object.fromEntries(Object.entries(body.questions).slice(0, 30))
        : undefined;
    const data = await this.service.startSession(user.userId, {
      classroomId: body.classroomId || undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      question: body.question,
      questions,
    });
    return { success: true, data };
  }

  /** A student joins with a code they were given (typed, or from a shared link). */
  @Post('join')
  @Roles(Role.STUDENT)
  async join(@CurrentUser() user: Requester, @Body() body: { code?: string }) {
    // Codes are short, so guessing is slowed hard: 10 tries a minute per student.
    let limiter = this.joinLimits.get(user.userId);
    if (!limiter) {
      limiter = new RateLimiter(10 / 60, 10);
      this.joinLimits.set(user.userId, limiter);
      if (this.joinLimits.size > 10_000) this.joinLimits.clear();
    }
    if (!limiter.take()) throw new HttpException('Too many tries. Wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    if (typeof body?.code !== 'string') throw new BadRequestException('Enter the code from your tutor.');
    const res = await this.service.joinByCode(user.userId, body.code);
    if (res.added) await this.gateway.studentAdded(res.sessionId);
    return { success: true, data: { sessionId: res.sessionId } };
  }

  /** The tutor's own sessions (quick and classroom), newest first. */
  @Get('sessions')
  @Roles(Role.TEACHER)
  async mine(@CurrentUser() user: Requester) {
    return { success: true, data: await this.service.listMine(user.userId) };
  }

  /** Search the tutor's own students (their classes and past sessions) to send the link. */
  @Get('my-students')
  @Roles(Role.TEACHER)
  async myStudents(@CurrentUser() user: Requester, @Query('q') q?: string) {
    return { success: true, data: await this.service.myStudents(user.userId, typeof q === 'string' ? q : '') };
  }

  /** Send the join link to chosen students through EdKairos Messages. */
  @Post('sessions/:id/invite')
  @Roles(Role.TEACHER)
  async invite(
    @CurrentUser() user: Requester,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { studentIds?: unknown },
  ) {
    const ids = Array.isArray(body?.studentIds)
      ? body.studentIds.filter((x): x is string => typeof x === 'string' && x.length <= 64)
      : [];
    if (ids.length === 0) throw new BadRequestException('Choose at least one student.');
    return { success: true, data: await this.service.invite(id, user.userId, ids) };
  }

  /**
   * Make a picture the question: a student's photo of their own homework, or the
   * tutor's picture for one board or all boards. The browser shrinks it first.
   */
  @Post('sessions/:id/question-picture')
  async questionPicture(
    @CurrentUser() user: Requester,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { boardId?: string; all?: boolean; image?: string; width?: number; height?: number; label?: string },
  ) {
    if (typeof body?.image !== 'string') throw new BadRequestException('Choose a picture.');
    const boardIds = await this.service.questionFromPicture(id, user.userId, {
      boardId: typeof body.boardId === 'string' ? body.boardId : undefined,
      all: body.all === true,
      image: body.image,
      width: Number(body.width),
      height: Number(body.height),
      label: typeof body.label === 'string' ? body.label : undefined,
    });
    await this.gateway.questionsChanged(id, boardIds);
    return { success: true, data: { boardIds } };
  }

  /** A question picture, for people in the session who can see it. */
  @Get('assets/:assetId')
  async asset(
    @CurrentUser() user: Requester,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Res() res: Response,
  ) {
    const { mime, data } = await this.service.readAsset(assetId, user);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(data));
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
