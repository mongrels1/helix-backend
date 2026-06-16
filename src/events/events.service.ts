import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from './queues/queue.constants';
import type {
  AssignmentOverdueJob,
  AttendanceRiskJob,
  EngagementDropJob,
  MasteryDropJob,
  SubmissionCreatedJob,
} from './queues/queue.types';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectQueue(QUEUES.SUBMISSION_CREATED)
    private readonly submissionQueue: Queue,
    @InjectQueue(QUEUES.ASSIGNMENT_OVERDUE)
    private readonly overdueQueue: Queue,
    @InjectQueue(QUEUES.MASTERY_DROP_DETECTED)
    private readonly masteryQueue: Queue,
    @InjectQueue(QUEUES.ATTENDANCE_RISK)
    private readonly attendanceQueue: Queue,
    @InjectQueue(QUEUES.ENGAGEMENT_DROP)
    private readonly engagementQueue: Queue,
  ) {}

  async emit(eventName: string, payload: Record<string, unknown>): Promise<void> {
    try {
      switch (eventName) {
        case QUEUES.SUBMISSION_CREATED:
          await this.submissionQueue.add(
            'process',
            payload as unknown as SubmissionCreatedJob,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          break;
        case QUEUES.ASSIGNMENT_OVERDUE:
          await this.overdueQueue.add(
            'process',
            payload as unknown as AssignmentOverdueJob,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          break;
        case QUEUES.MASTERY_DROP_DETECTED:
          await this.masteryQueue.add(
            'process',
            payload as unknown as MasteryDropJob,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          break;
        case QUEUES.ATTENDANCE_RISK:
          await this.attendanceQueue.add(
            'process',
            payload as unknown as AttendanceRiskJob,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          break;
        case QUEUES.ENGAGEMENT_DROP:
          await this.engagementQueue.add(
            'process',
            payload as unknown as EngagementDropJob,
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          break;
        default:
          this.logger.warn(`Unknown event: ${eventName}`);
      }
      this.logger.log(`[EVENT QUEUED] ${eventName}`);
    } catch (error) {
      this.logger.warn(
        `[EVENT FALLBACK] ${eventName} - Redis unavailable: ${String(error)}`,
      );
    }
  }
}
