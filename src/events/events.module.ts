import { Global, Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AssignmentsModule } from '@modules/assignments/assignments.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { MasteryEngineModule } from '../intelligence/mastery-engine/mastery-engine.module';
import { PacingEngineModule } from '../intelligence/pacing-engine/pacing-engine.module';
import { InstructorAssistantModule } from '../intelligence/instructor-assistant/instructor-assistant.module';
import { EventsService } from './events.service';
import { AssignmentOverdueProcessor } from './processors/assignment-overdue.processor';
import { AssignmentOverdueScheduler } from './processors/assignment-overdue.scheduler';
import { AttendanceProcessor } from './processors/attendance.processor';
import { EngagementProcessor } from './processors/engagement.processor';
import { MasteryProcessor } from './processors/mastery.processor';
import { SubmissionProcessor } from './processors/submission.processor';
import { QUEUES } from './queues/queue.constants';

const isTest = process.env.NODE_ENV === 'test';
const noOpQueue = { add: async () => undefined };
const testQueueProviders = Object.values(QUEUES).map((queueName) => ({
  provide: getQueueToken(queueName),
  useValue: noOpQueue,
}));
const queueRuntimeImports = isTest
  ? []
  : [
      // NOTE: ScheduleModule.forRoot() is registered ONCE in AppModule and must
      // not be called again here. A second forRoot() registers the scheduler
      // orchestrator twice, so every @Cron in the app fires twice — which is
      // what sent every family two weekly reports and doubled every scheduler
      // log line. Same rule already documented in reminders.module.ts.
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            url: config.get<string>('redis.url') ?? 'redis://localhost:6379',
          },
        }),
      }),
      BullModule.registerQueue(
        { name: QUEUES.SUBMISSION_CREATED },
        { name: QUEUES.ASSIGNMENT_OVERDUE },
        { name: QUEUES.MASTERY_DROP_DETECTED },
        { name: QUEUES.ATTENDANCE_RISK },
        { name: QUEUES.ENGAGEMENT_DROP },
      ),
    ];
const queueRuntimeProviders = isTest
  ? testQueueProviders
  : [
      SubmissionProcessor,
      AssignmentOverdueProcessor,
      MasteryProcessor,
      AttendanceProcessor,
      EngagementProcessor,
      AssignmentOverdueScheduler,
    ];

@Global()
@Module({
  imports: [
    NotificationsModule,
    AssignmentsModule,
    MasteryEngineModule,
    PacingEngineModule,
    InstructorAssistantModule,
    ...queueRuntimeImports,
  ],
  providers: [
    EventsService,
    ...queueRuntimeProviders,
  ],
  exports: [EventsService],
})
export class EventsModule {}
