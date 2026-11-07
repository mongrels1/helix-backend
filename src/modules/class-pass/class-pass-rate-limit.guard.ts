import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

/**
 * Per-IP ceiling on the public Class Pass endpoints. A whole school shares one
 * public IP, so this is deliberately generous (a class of 30 signing in at the
 * bell is nowhere near it); it exists to stop scripted floods. The real
 * protection is per student: the backup code locks after 5 misses, and badge
 * secrets are ~129 bits, so they cannot be guessed at any rate.
 *
 * Env: CLASS_PASS_RATE_MAX (default 600 per window), CLASS_PASS_RATE_WINDOW_MS (default 10 min).
 */
@Injectable()
export class ClassPassRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs = Number(process.env.CLASS_PASS_RATE_WINDOW_MS) || 10 * 60 * 1000;
  private readonly max = Number(process.env.CLASS_PASS_RATE_MAX) || 600;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();
    const fwd = req.headers['x-forwarded-for'];
    const ip = String((Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || 'unknown');
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      throw new HttpException('Too many sign-in attempts. Please wait a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) {
      for (const [key, times] of this.hits) {
        if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
      }
    }
    return true;
  }
}
