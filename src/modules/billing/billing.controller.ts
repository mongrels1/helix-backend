import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { BillingService } from './billing.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

/**
 * The family's own billing: what plan they are on, and a door to Stripe's
 * hosted billing page (update card, invoices, cancel). Self-serve roles only.
 */
@Controller('api/v1/billing')
@Roles(Role.PARENT, Role.STUDENT)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.summary(user.userId);
  }

  @Post('portal')
  @HttpCode(200)
  portal(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.portalLink(user.userId, user.role);
  }
}
