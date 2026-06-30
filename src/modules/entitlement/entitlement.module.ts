import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EntitlementService } from './entitlement.service';

/**
 * Shared paid-feature entitlement (own subscription OR a linked parent's family
 * subscription). Exported for /me and for the gate guard on paid endpoints.
 */
@Module({
  imports: [PrismaModule],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementModule {}
