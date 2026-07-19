import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { EntitlementGuard } from '@common/guards/entitlement.guard';
import { PracticeService } from './practice.service';

/**
 * Student practice surface. Gated by EntitlementGuard: a learner needs an active
 * subscription (own or a linked parent's family plan); staff bypass. The global
 * JwtAuthGuard still requires a valid token.
 */
@Controller('api/v1/practice')
@UseGuards(EntitlementGuard)
export class PracticeController {
  constructor(private readonly svc: PracticeService) {}

  @Get('items')
  async items(
    @Query() q: { grade?: string; standard?: string; limit?: string },
    @Req() req: { user?: { userId?: string; id?: string } },
  ) {
    const data = await this.svc.items((req.user?.userId ?? req.user?.id), q);
    return { success: true as const, data };
  }

  @Post('responses')
  async recordResponse(
    @Body() body: { itemId: string; pickedIndex: number },
    @Req() req: { user?: { userId?: string; id?: string } },
  ) {
    const data = await this.svc.recordResponse((req.user?.userId ?? req.user?.id), body);
    return { success: true as const, data };
  }

  @Get('misconceptions')
  async misconceptions(@Req() req: { user?: { userId?: string; id?: string } }) {
    const data = await this.svc.misconceptionSummary((req.user?.userId ?? req.user?.id));
    return { success: true as const, data };
  }
}
