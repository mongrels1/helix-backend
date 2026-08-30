import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MeteredGuard } from '@common/guards/metered.guard';
import { Meter } from '@common/decorators/meter.decorator';
import { UsageService } from '@modules/usage/usage.service';
import { PracticeService } from './practice.service';

/**
 * Student practice surface. Metered rather than locked: anyone signed in may
 * open the page and load items, and only answering costs one of the day's
 * allowance. Subscribers, staff and institutional families are not counted at
 * all. The global JwtAuthGuard still requires a valid token.
 */
@Controller('api/v1/practice')
@UseGuards(MeteredGuard)
export class PracticeController {
  constructor(
    private readonly svc: PracticeService,
    private readonly usage: UsageService,
  ) {}

  @Get('items')
  async items(
    @Query() q: { grade?: string; standard?: string; limit?: string },
    @Req() req: { user?: { userId?: string; id?: string } },
  ) {
    const data = await this.svc.items((req.user?.userId ?? req.user?.id), q);
    return { success: true as const, data };
  }

  /** Answering one item. The metered action; charged only after it is recorded. */
  @Post('responses')
  @Meter('PRACTICE')
  async recordResponse(
    @Body() body: { itemId: string; pickedIndex: number },
    @Req() req: { user?: { userId?: string; id?: string } },
  ) {
    const userId = req.user?.userId ?? req.user?.id;
    const data = await this.svc.recordResponse(userId, body);
    if (userId) await this.usage.consume(userId, 'PRACTICE');
    return { success: true as const, data };
  }

  @Get('misconceptions')
  async misconceptions(@Req() req: { user?: { userId?: string; id?: string } }) {
    const data = await this.svc.misconceptionSummary((req.user?.userId ?? req.user?.id));
    return { success: true as const, data };
  }
}
