import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AdminExperienceService } from '../admin/admin-experience.service';

interface AuthenticatedUser {
  userId: string;
}

/**
 * What the signed-in account is on — for the product ribbon.
 *
 * Deliberately **not** role-gated. Every other controller in this module is
 * scoped to one role, which is correct for dashboards; this one answers a
 * question every signed-in person has an equal right to ask about their own
 * account, and it answers it only about the caller. There is no id parameter,
 * so there is nothing to enumerate.
 *
 * A scholar's product comes from the parent paying for them, resolved by the
 * same rule `EntitlementService` uses to decide access — so the ribbon cannot
 * say "Free" on a child whose mother is being charged $39.99, which is the
 * failure that prompted it.
 *
 * It returns the full definition including `includes`, because the ribbon opens
 * onto that list. A family reading what they are owed should not need a second
 * request, and the list is short.
 */
@Controller('api/v1/experience/me')
export class MeExperienceController {
  constructor(private readonly adminExperienceService: AdminExperienceService) {}

  @Get('product')
  async product(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['getProductForUser']>> }> {
    const data = await this.adminExperienceService.getProductForUser(user.userId);
    return { success: true, data };
  }
}
