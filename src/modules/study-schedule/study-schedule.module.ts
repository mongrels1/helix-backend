import { Module } from '@nestjs/common';
import { StudyScheduleController } from './study-schedule.controller';
import { StudyScheduleRepository } from './study-schedule.repository';
import { StudyScheduleService } from './study-schedule.service';

// PrismaModule is global, so PrismaService is injectable without importing it.
@Module({
  controllers: [StudyScheduleController],
  providers: [StudyScheduleService, StudyScheduleRepository],
  exports: [StudyScheduleService, StudyScheduleRepository],
})
export class StudyScheduleModule {}
