import { NotificationChannel } from '@prisma/client';
import { Job } from 'bullmq';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { AttendanceProcessor } from './attendance.processor';

describe('AttendanceProcessor', () => {
  it('creates an in-app notification for attendance risk jobs', async () => {
    const notificationsService = {
      notify: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<NotificationsService>;
    const processor = new AttendanceProcessor(notificationsService);
    const data = { studentId: 'student-1', classroomId: 'classroom-1' };

    await processor.process({ data } as Job<typeof data>);

    expect(notificationsService.notify).toHaveBeenCalledWith({
      userId: 'student-1',
      title: 'Attendance Risk Alert',
      body: '3 consecutive absences recorded. Please contact your teacher.',
      channel: NotificationChannel.IN_APP,
      metadata: data,
    });
  });
});
