import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasteryEngineModule } from '../mastery-engine/mastery-engine.module';
import { DiagnosticController } from './diagnostic.controller';
import { DiagnosticService } from './diagnostic.service';
import { RemediationModule } from '../remediation/remediation.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';

@Module({
  imports: [PrismaModule, MasteryEngineModule, RemediationModule, NotificationsModule],
  providers: [DiagnosticService],
  controllers: [DiagnosticController],
  exports: [DiagnosticService],
})
export class DiagnosticModule {}
