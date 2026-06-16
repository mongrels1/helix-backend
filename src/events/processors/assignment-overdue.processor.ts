import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { InstructorAssistantService } from '../../intelligence/instructor-assistant/instructor-assistant.service';
import { QUEUES } from '../queues/queue.constants';
import { AssignmentOverdueJob } from '../queues/queue.types';

@Processor(QUEUES.ASSIGNMENT_OVERDUE)
export class AssignmentOverdueProcessor extends WorkerHost {
  private readonly logger = new Logger(AssignmentOverdueProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly instructorAssistantService: InstructorAssistantService,
  ) {
    super();
  }

  async process(job: Job<AssignmentOverdueJob>): Promise<void> {
    await this.instructorAssistantService.generateInsight({
      classroomId: job.data.classroomId,
      assignmentId: job.data.assignmentId,
    });
    void this.notificationsService;
  }
}
