import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { StudyAdminService } from './study-admin.service';

/** Parse an optional ISO date query param; ignore anything unparseable. */
function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Staff-facing engagement CMS. Super-admin only. Read-only aggregates over the
 * schedule, login, and reminder data the scheduling subsystem produces.
 */
@Controller('api/v1/study-admin')
export class StudyAdminController {
  constructor(private readonly service: StudyAdminService) {}

  @Get('overview')
  @Roles(Role.SUPER_ADMIN)
  async overview(@Query('days', new DefaultValuePipe(14), ParseIntPipe) days: number) {
    const data = await this.service.overview(days);
    return { success: true, data };
  }

  @Get('students/:id/engagement')
  @Roles(Role.SUPER_ADMIN)
  async engagement(
    @Param('id') id: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    const data = await this.service.studentEngagement(id, days);
    return { success: true, data };
  }

  @Get('reminders')
  @Roles(Role.SUPER_ADMIN)
  async reminders(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.service.reminderLog({
      studentId: studentId || undefined,
      from: parseDate(from),
      to: parseDate(to),
      page,
      limit,
    });
    return { success: true, data };
  }

  @Get('logins')
  @Roles(Role.SUPER_ADMIN)
  async logins(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.service.loginLog({
      studentId: studentId || undefined,
      from: parseDate(from),
      to: parseDate(to),
      page,
      limit,
    });
    return { success: true, data };
  }
}
