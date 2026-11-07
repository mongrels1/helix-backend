import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { EntitlementModule } from '@modules/entitlement/entitlement.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClassPassController } from './class-pass.controller';
import { ClassPassRateLimitGuard } from './class-pass-rate-limit.guard';
import { ClassPassService } from './class-pass.service';

@Module({
  imports: [PrismaModule, AuthModule, EntitlementModule],
  controllers: [ClassPassController],
  providers: [ClassPassService, ClassPassRateLimitGuard],
  exports: [ClassPassService],
})
export class ClassPassModule {}
