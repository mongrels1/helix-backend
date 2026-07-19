import { Module } from '@nestjs/common';
import { EmailModule } from '@modules/email/email.module';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe.controller';

// PrismaModule is @Global, so PrismaService is injectable here without importing it.
@Module({
  imports: [EmailModule],
  controllers: [StripeWebhookController],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
