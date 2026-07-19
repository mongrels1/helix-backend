import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe.controller';

// PrismaModule is @Global, so PrismaService is injectable here without importing it.
@Module({
  controllers: [StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
