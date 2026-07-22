import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { KSportsService } from './ksports.service';
import { RecordFactDto } from './dto/record-fact.dto';

type AuthenticatedUser = { userId: string; role: Role };

@Controller('api/v1/ksports')
export class KSportsController {
  constructor(private readonly ksportsService: KSportsService) {}

  // GET /api/v1/ksports/progress — this student's mastered facts + counts.
  @Get('progress')
  @Roles(Role.STUDENT)
  async getProgress(@CurrentUser() currentUser: AuthenticatedUser) {
    const data = await this.ksportsService.getProgress(currentUser.userId);
    return { success: true, data };
  }

  // POST /api/v1/ksports/progress { module, factKey } — idempotent record.
  @Post('progress')
  @Roles(Role.STUDENT)
  async record(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: RecordFactDto,
  ) {
    const data = await this.ksportsService.recordFact(
      currentUser.userId,
      dto.module,
      dto.factKey,
    );
    return { success: true, data };
  }
}
