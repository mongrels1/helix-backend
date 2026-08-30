import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EntitlementModule } from '../entitlement/entitlement.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

/**
 * The free tier's daily allowance. Exported so MeteredGuard and the learning
 * controllers can read and consume it, and so the parent dashboard can build
 * the "she ran out on 5 of the last 7 days" line from real data.
 */
@Module({
  imports: [PrismaModule, EntitlementModule],
  controllers: [UsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
