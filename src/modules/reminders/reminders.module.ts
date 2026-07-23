import { Module } from '@nestjs/common';
import { RemindersRepository } from './reminders.repository';
import { RemindersScheduler } from './reminders.scheduler';
import { RemindersService } from './reminders.service';

// PrismaModule is global; ScheduleModule.forRoot() is registered in AppModule, so
// the @Cron in RemindersScheduler is discovered wherever the provider lives.
@Module({
  providers: [RemindersService, RemindersRepository, RemindersScheduler],
  exports: [RemindersService],
})
export class RemindersModule {}
