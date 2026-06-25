import { Body, Controller, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { StartRemediationDto } from './dto/start-remediation.dto';
import { SubmitRecheckDto } from './dto/submit-recheck.dto';
import {
  RecheckResult,
  RemediationLesson,
  RemediationService,
} from './remediation.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

@Controller('api/v1/remediation')
@Roles(Role.STUDENT)
export class RemediationController {
  constructor(private readonly remediationService: RemediationService) {}

  /** Build a targeted mini-lesson + re-check for a gap KC ("Learn this"). */
  @Post('lesson')
  async lesson(
    @Body() dto: StartRemediationDto,
  ): Promise<{ success: true; data: RemediationLesson }> {
    const data = await this.remediationService.buildLesson(dto);
    return { success: true, data };
  }

  /** Grade a completed re-check and feed it back into the mastery engine. */
  @Post('recheck')
  async recheck(
    @Body() dto: SubmitRecheckDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: RecheckResult }> {
    const data = await this.remediationService.recordRecheck(user.userId, dto);
    return { success: true, data };
  }
}
