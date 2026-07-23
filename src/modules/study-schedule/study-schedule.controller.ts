import { Body, Controller, Get, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { SetScheduleDto } from './dto/set-schedule.dto';
import { StudyScheduleService, StudyScheduleView } from './study-schedule.service';

type AuthenticatedUser = { userId: string; role: Role };

/**
 * A student's own weekly study plan. Both routes operate on the CALLER's own
 * account (`@CurrentUser`), never an arbitrary id, so there's no cross-account
 * exposure. Staff-facing views of other students' plans come with the CMS phase.
 */
@Controller('api/v1/study-schedule')
export class StudyScheduleController {
  constructor(private readonly service: StudyScheduleService) {}

  @Get('me')
  async getMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: StudyScheduleView }> {
    const data = await this.service.getMine(user.userId);
    return { success: true, data };
  }

  @Put('me')
  async setMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetScheduleDto,
  ): Promise<{ success: true; data: StudyScheduleView }> {
    const data = await this.service.setMine(user.userId, dto);
    return { success: true, data };
  }
}
