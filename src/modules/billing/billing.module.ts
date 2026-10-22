import { Module } from '@nestjs/common';
import { EmailModule } from '@modules/email/email.module';
import { StripeModule } from '@modules/stripe/stripe.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

// PrismaModule is @Global, so PrismaService is injectable here without importing it.
@Module({
  imports: [StripeModule, EmailModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
