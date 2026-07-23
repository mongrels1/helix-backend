import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * In-memory per-IP rate limiter for the public signup endpoint. Railway runs a
 * single replica, so a process-local sliding window is sufficient (no Redis / no
 * new dependency). A burst of bot signups from one IP is capped hard; a real
 * family signing up a couple of accounts is never affected.
 *
 * Tunable via env: SIGNUP_RATE_MAX (default 5), SIGNUP_RATE_WINDOW_MS (default 1h).
 */
@Injectable()
export class SignupRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs = Number(process.env.SIGNUP_RATE_WINDOW_MS) || 60 * 60 * 1000;
  private readonly max = Number(process.env.SIGNUP_RATE_MAX) || 5;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const fwd = req.headers['x-forwarded-for'];
    const ip = String(
      (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || 'unknown',
    );

    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      throw new HttpException(
        'Too many signup attempts from this network. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(ip, recent);

    // Opportunistic sweep so the map can't grow unbounded under attack.
    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) {
        if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
      }
    }
    return true;
  }
}
