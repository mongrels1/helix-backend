import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '@modules/email/email.module';
import { UsersModule } from '@modules/users/users.module';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';

/**
 * Provisioning from external purchase events (GHL). Creates accounts + emails a
 * one-time activation link so a buyer can log straight into the product.
 */
@Module({
  imports: [PrismaModule, EmailModule, UsersModule],
  controllers: [ProvisioningController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
