import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { NotificationChannel } from '@prisma/client';
import { Job } from 'bullmq';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PacingEngineService } from '../../intelligence/pacing-engine/pacing-engine.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES } from '../queues/queue.constants';
import { MasteryDropJob } from '../queues/queue.types';
@Processor(QUEUES.MASTERY_DROP_DETECTED)
export class MasteryProcessor extends WorkerHost {
  private readonly logger = new Logger(MasteryProcessor.name);
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pacingEngineService: PacingEngineService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }
  async process(job: Job<MasteryDropJob>): Promise<void> {
    const { studentId, skillTag, currentScore, insight } = job.data;
    // A pacing recommendation belongs to a TEACHER in a CLASSROOM. A self-serve
    // diagnostic taker has neither, and `classroomId` arrives undefined.
    // This used to coerce that to '' — which is not a Classroom id, so every insert
    // died on PacingRecommendation_classroomId_fkey, AFTER paying for the AI call that
    // generated it. Skip the whole path instead: no classroom, no recommendation, no spend.
    if (job.data.classroomId) {
      await this.pacingEngineService.adjust({
        studentId: job.data.studentId,
        classroomId: job.data.classroomId,
        skillTag: job.data.skillTag,
        currentScore: job.data.currentScore,
        slope: job.data.slope,
        insight: job.data.insight as string | undefined,
      });
      this.logger.log(`AI tutor intervention queued for studentId=${studentId}`);
    } else {
      this.logger.log(
        `mastery drop (studentId=${studentId}, skill=${skillTag}): no classroom; skipping pacing recommendation`,
      );
    }
    const classroomId = job.data.classroomId;
    let teacherId: string | null = null;
    if (classroomId) {
      try {
        const classroom = await this.prisma.classroom.findUnique({
          where: { id: classroomId },
          select: { teacherId: true },
        });
        teacherId = classroom?.teacherId ?? null;
      } catch {
        teacherId = null;
      }
    }
    if (!teacherId) {
      this.logger.warn(
        `mastery drop (studentId=${studentId}, skill=${skillTag}): no teacher resolved (classroomId=${classroomId ?? 'none'}); skipping alert`,
      );
      return;
    }
    await this.notificationsService.notify({
      userId: teacherId,
      title: 'Mastery Drop Detected',
      body: `${skillTag}: ${(currentScore * 100).toFixed(0)}%. ${insight}`,
      channel: NotificationChannel.IN_APP,
      metadata: job.data as unknown as Record<string, unknown>,
    });
  }
}
