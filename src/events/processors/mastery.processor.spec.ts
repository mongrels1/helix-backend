import { NotificationChannel } from '@prisma/client';
import { Job } from 'bullmq';
import { PacingEngineService } from '../../intelligence/pacing-engine/pacing-engine.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { MasteryProcessor } from './mastery.processor';

describe('MasteryProcessor', () => {
  it('calls pacing engine and keeps notification behavior', async () => {
    const notificationsService = {
      notify: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<NotificationsService>;
    const pacingEngineService = {
      adjust: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PacingEngineService>;
    const processor = new MasteryProcessor(
      notificationsService,
      pacingEngineService,
    );
    const data = {
      studentId: 'student-1',
      classroomId: 'classroom-1',
      skillTag: 'fractions',
      currentScore: 0.45,
      slope: -0.1,
      insight: 'Teacher insight',
    };

    await processor.process({ data } as Job<typeof data>);

    expect(pacingEngineService.adjust).toHaveBeenCalledWith(data);
    expect(notificationsService.notify).toHaveBeenCalledWith({
      userId: 'student-1',
      title: 'Mastery Drop Detected',
      body: 'fractions: 45%. Teacher insight',
      channel: NotificationChannel.IN_APP,
      metadata: data,
    });
  });
});
