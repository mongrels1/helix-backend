import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { ImportRosterDto } from './dto/import-roster.dto';
import {
  RosterCaller,
  RosterImportResult,
  RosterService,
} from './roster.service';

@Controller('api/v1/classrooms')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  // Bulk-provision a class roster from a parsed CSV. Teacher (own class) or admin.
  @Post(':id/roster')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(200)
  async importRoster(
    @Param('id') id: string,
    @Body() dto: ImportRosterDto,
    @CurrentUser() user: RosterCaller,
  ): Promise<{ success: true; data: RosterImportResult }> {
    return { success: true, data: await this.roster.importRoster(id, user, dto) };
  }
}
