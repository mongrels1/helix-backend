import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { EntitlementService } from '@modules/entitlement/entitlement.service';

const STAFF_ROLES = new Set(['TEACHER', 'ORG_ADMIN', 'SUPER_ADMIN']);

/**
 * Hard-enforces a paid subscription at the API. Apply to student-facing paid
 * endpoints (AI Tutor, Practice). Runs AFTER the global JwtAuthGuard, so req.user
 * is populated. Staff always pass; a learner passes only if entitled (own active
 * plan OR a linked parent's active family plan). The diagnostic is never guarded.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly entitlement: EntitlementService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { userId?: string; id?: string; role?: string } | undefined;
    const userId = user?.userId ?? user?.id;
    if (!userId) throw new UnauthorizedException();
    if (user?.role && STAFF_ROLES.has(user.role)) return true;

    const ok = await this.entitlement.isEntitled(userId);
    if (!ok) {
      throw new ForbiddenException({
        error: { code: 'subscription_required', message: 'An active subscription is required to use this feature.' },
      });
    }
    return true;
  }
}
