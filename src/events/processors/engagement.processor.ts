import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { InstructorAssistantService } from '../../intelligence/instructor-assistant/instructor-assistant.service';
import { PacingEngineService } from '../../intelligence/pacing-engine/pacing-engine.service';
import { QUEUES } from '../queues/queue.constants';
import { EngagementDropJob } from '../queues/queue.types';

@Processor(QUEUES.ENGAGEMENT_DROP)
export class EngagementProcessor extends WorkerHost {
  private readonly logger = new Logger(EngagementProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pacingEngineService: PacingEngineService,
    private readonly instructorAssistantService: InstructorAssistantService,
  ) {
    super();
  }

  async process(job: Job<EngagementDropJob>): Promise<void> {
    await this.pacingEngineService.adjustLesson({
      studentId: job.data.studentId,
      classroomId: job.data.classroomId,
      lessonId: job.data.lessonId as string | undefined,
    });
    await this.instructorAssistantService.generateWarmUp({
      classroomId: job.data.classroomId,
      lessonId: job.data.lessonId as string | undefined,
    });
    void this.notificationsService;
  }
}
