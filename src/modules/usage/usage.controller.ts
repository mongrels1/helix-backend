import { Controller, Get, Req } from '@nestjs/common';
import { UsageService } from './usage.service';

/**
 * What the counter reads.
 *
 * One call returns every metered feature, so a dashboard renders the whole
 * allowance without fanning out. An unmetered account gets `metered: false`
 * everywhere and the client renders nothing at all - no counter, no price. That
 * is how an institutional family never sees a number.
 */
@Controller('api/v1/usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /**
   * Per-child seven-day summary for a parent. Empty when the parent is not
   * metered, so an institutional family's dashboard renders nothing.
   */
  @Get('children')
  async children(@Req() req: { user?: { userId?: string; id?: string } }) {
    const userId = req.user?.userId ?? req.user?.id;
    const data = userId
      ? await this.usage.childrenSummary(userId)
      : { metered: false, children: [] };
    return { success: true as const, data };
  }

  @Get('me')
  async me(@Req() req: { user?: { userId?: string; id?: string } }) {
    const userId = req.user?.userId ?? req.user?.id;
    const states = userId ? await this.usage.allStates(userId) : [];
    return {
      success: true as const,
      data: {
        metered: states.some((s) => s.metered),
        features: Object.fromEntries(
          states.map((s) => [
            s.kind,
            { used: s.used, allowance: s.allowance, remaining: s.remaining, intro: s.intro, metered: s.metered },
          ]),
        ),
      },
    };
  }
}
