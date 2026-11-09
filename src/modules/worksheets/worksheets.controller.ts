import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AnswersDto, AssignWorksheetDto, CreateWorksheetDto, DraftWorksheetDto } from './dto/worksheet.dto';
import { Caller, WorksheetsService } from './worksheets.service';

/**
 * Build W: upload a worksheet + A–D key, assign it, and score it on the server.
 * Teacher routes are role-gated here; every route also checks class access in
 * the service (the one central check), and students only ever reach work that
 * is assigned to them.
 */
@Controller('api/v1/worksheets')
export class WorksheetsController {
  constructor(private readonly service: WorksheetsService) {}

  @Post('draft')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async draft(@Body() dto: DraftWorksheetDto) {
    return { success: true, data: await this.service.draft(dto) };
  }

  @Post()
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async create(@CurrentUser() user: Caller, @Body() dto: CreateWorksheetDto) {
    return { success: true, data: await this.service.create(user, dto) };
  }

  @Get('mine')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async mine(@CurrentUser() user: Caller) {
    return { success: true, data: await this.service.mine(user) };
  }

  @Get('assign-targets')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async assignTargets(@CurrentUser() user: Caller) {
    return { success: true, data: await this.service.assignTargets(user) };
  }

  @Post(':id/assign')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async assign(@CurrentUser() user: Caller, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignWorksheetDto) {
    return { success: true, data: await this.service.assign(user, id, dto) };
  }

  @Get('assignments/:assignmentId/results')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async results(@CurrentUser() user: Caller, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return { success: true, data: await this.service.results(user, assignmentId) };
  }

  @Get('assignments/:assignmentId')
  async sheet(@CurrentUser() user: Caller, @Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return { success: true, data: await this.service.sheet(user, assignmentId) };
  }

  @Put('assignments/:assignmentId/answers')
  @Roles(Role.STUDENT)
  async saveDraft(@CurrentUser() user: Caller, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: AnswersDto) {
    return { success: true, data: await this.service.saveDraft(user, assignmentId, dto.answers) };
  }

  @Post('assignments/:assignmentId/submit')
  @Roles(Role.STUDENT)
  async submit(@CurrentUser() user: Caller, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Body() dto: AnswersDto) {
    return { success: true, data: await this.service.submit(user, assignmentId, dto.answers) };
  }

  @Get('pages/:pageId')
  async page(@CurrentUser() user: Caller, @Param('pageId', ParseUUIDPipe) pageId: string, @Res() res: Response) {
    const { mime, data } = await this.service.page(user, pageId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(data));
  }
}
