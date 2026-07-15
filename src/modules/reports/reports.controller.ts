import { Controller, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('weekly/me/preview')
  @HttpCode(200)
  async previewMine(@CurrentUser() user: AuthenticatedUser): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['previewForUser']>>;
  }> {
    return { success: true, data: await this.reports.previewForUser(user.userId) };
  }

  @Post('weekly/me')
  @HttpCode(200)
  async sendMine(@CurrentUser() user: AuthenticatedUser): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['sendReportForUser']>>;
  }> {
    return { success: true, data: await this.reports.sendReportForUser(user.userId) };
  }

  @Post('weekly/run')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(200)
  async runBatch(): Promise<{
    success: true;
    data: Awaited<ReturnType<ReportsService['runWeeklyBatch']>>;
  }> {
    return { success: true, data: await this.reports.runWeeklyBatch() };
  }
}
