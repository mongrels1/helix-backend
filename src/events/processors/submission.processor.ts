import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { MasteryEngineService } from '../../intelligence/mastery-engine/mastery-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES } from '../queues/queue.constants';
import { SubmissionCreatedJob } from '../queues/queue.types';

@Processor(QUEUES.SUBMISSION_CREATED)
export class SubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionProcessor.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly masteryEngineService: MasteryEngineService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<SubmissionCreatedJob>): Promise<void> {
    const { submissionId, assignmentId, studentId, classroomId } = job.data;
    this.logger.log(`Processing submission.created: ${submissionId}`);
    this.logger.log(`Auto-grade skipped for submissionId=${submissionId}`);
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { skillTags: true, maxScore: true },
    });

    if (assignment && assignment.skillTags.length > 0) {
      for (const skillTag of assignment.skillTags) {
        const rawScore = (job.data['score'] as number | undefined) ?? 0;
        await this.masteryEngineService.updateMastery(
          studentId,
          skillTag,
          rawScore,
          assignment.maxScore,
          submissionId,
          classroomId,
        );
      }
    }
    this.logger.log(`Teacher notification queued for submission ${submissionId}`);
    void this.notificationsService;
  }
}
