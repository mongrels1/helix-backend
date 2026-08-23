import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { AccelerationService } from './acceleration.service';
import { gaRegistryStats } from './ga-standards';

/**
 * Acceleration evidence — STAFF ONLY.
 *
 * Deliberately not exposed to STUDENT or PARENT. What this returns is
 * documentation for a teacher or an academic strategist to read and judge, not
 * a badge for a family. EdKairos does not promise a placement; it prepares the
 * case and the school decides. A "two grades ahead" number rendered on a parent
 * dashboard is a claim, and this endpoint deliberately does not make it — it
 * hands back demonstrated standards, with the grade comparison marked as
 * resting on a self-reported field.
 */
@Controller('api/v1/standards')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class AccelerationController {
  constructor(private readonly svc: AccelerationService) {}

  /** Registry health — which standards document is loaded, how much is reviewed. */
  @Get('registry')
  registry() {
    return { success: true as const, data: gaRegistryStats() };
  }

  /** Everything one student has demonstrated, standards first. */
  @Get('acceleration/:userId')
  async evidence(@Param('userId') userId: string) {
    const data = await this.svc.evidenceFor(userId);
    return { success: true as const, data };
  }

  /**
   * Several students at once, ordered by grade delta. `userIds` is a
   * comma-separated list; capped server-side. For scanning a class, not for
   * building a shortlist to send anywhere.
   */
  @Get('acceleration')
  async cohort(@Query('userIds') userIds?: string) {
    const ids = String(userIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const data = ids.length ? await this.svc.cohort(ids) : [];
    return { success: true as const, data };
  }
}
