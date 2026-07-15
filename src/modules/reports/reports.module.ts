import { Module } from '@nestjs/common';
import { EmailModule } from '@modules/email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsScheduler } from './reports.scheduler';

@Module({
  imports: [EmailModule, PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsScheduler],
  exports: [ReportsService],
})
export class ReportsModule {}
