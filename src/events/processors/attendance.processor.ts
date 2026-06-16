import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { NotificationChannel } from '@prisma/client';
import { Job } from 'bullmq';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { QUEUES } from '../queues/queue.constants';
import { AttendanceRiskJob } from '../queues/queue.types';

@Processor(QUEUES.ATTENDANCE_RISK)
export class AttendanceProcessor extends WorkerHost {
  private readonly logger = new Logger(AttendanceProcessor.name);

  constructor(private readonly notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job<AttendanceRiskJob>): Promise<void> {
    const { studentId } = job.data;
    await this.notificationsService.notify({
      userId: studentId,
      title: 'Attendance Risk Alert',
      body: '3 consecutive absences recorded. Please contact your teacher.',
      channel: NotificationChannel.IN_APP,
      metadata: job.data as unknown as Record<string, unknown>,
    });
    this.logger.log(`Attendance risk detected for studentId=${studentId}`);
  }
}
