import { Module } from '@nestjs/common';
import { ReferralService } from './referral.service';
import { StripeModule } from '@modules/stripe/stripe.module';
import { EmailModule } from '@modules/email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [StripeModule, EmailModule, PrismaModule],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
