import { Module } from '@nestjs/common';
import { FellowsApplyController } from './fellows-apply.controller';

/**
 * EdKairos Fellows — application intake.
 *
 * No providers and no PrismaModule on purpose: the apply path touches no database. It
 * scores in memory, verifies a signed diagnostic token, and forwards to GHL. Keeping it
 * dependency-free is what lets it stay up when everything else is mid-deploy.
 *
 * Register in app.module.ts alongside the other feature modules.
 */
@Module({
  controllers: [FellowsApplyController],
})
export class FellowsModule {}
