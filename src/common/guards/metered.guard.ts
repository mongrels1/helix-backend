import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsageService } from '@modules/usage/usage.service';
import { METER_KEY } from '../decorators/meter.decorator';
import type { UsageKind } from '../usage/usage.constants';

/**
 * The free tier, enforced.
 *
 * Replaces EntitlementGuard on the learning surfaces. EntitlementGuard was a
 * locked door: no plan, no access, nothing seen. That is the design the category
 * evidence argues against and it is why a prospect could sign up and find
 * nothing to do. This guard lets everyone in and counts instead.
 *
 *  - No @Meter() on the handler  -> always allowed. Reads are never rationed.
 *  - Unmetered account            -> always allowed, nothing counted.
 *  - Metered account with budget  -> allowed. The handler consumes on success.
 *  - Metered account at zero      -> 403 daily_limit_reached, carrying the
 *                                    numbers so the client can render the
 *                                    both-doors card without a second call.
 *
 * The cap is enforced here rather than in the client because a client-side
 * counter is a suggestion.
 */
@Injectable()
export class MeteredGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<UsageKind | undefined>(METER_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!kind) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { userId?: string; id?: string } | undefined;
    const userId = user?.userId ?? user?.id;
    if (!userId) throw new UnauthorizedException();

    const state = await this.usage.state(userId, kind);
    if (state.unlimited || state.remaining > 0) return true;

    throw new ForbiddenException({
      error: {
        code: 'daily_limit_reached',
        message: `That's today's ${state.allowance}. They reset at midnight.`,
        kind,
        used: state.used,
        allowance: state.allowance,
        remaining: 0,
        resetsAt: 'midnight',
      },
    });
  }
}
