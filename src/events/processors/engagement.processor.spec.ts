import { Job } from 'bullmq';
import { InstructorAssistantService } from '../../intelligence/instructor-assistant/instructor-assistant.service';
import { PacingEngineService } from '../../intelligence/pacing-engine/pacing-engine.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { EngagementProcessor } from './engagement.processor';

describe('EngagementProcessor', () => {
  it('calls pacing engine for engagement drop jobs', async () => {
    const pacingEngineService = {
      adjustLesson: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PacingEngineService>;
    const instructorAssistantService = {
      generateWarmUp: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<InstructorAssistantService>;
    const processor = new EngagementProcessor(
      {} as NotificationsService,
      pacingEngineService,
      instructorAssistantService,
    );
    const data = {
      studentId: 'student-1',
      classroomId: 'classroom-1',
      lessonId: 'lesson-1',
    };

    await processor.process({ data } as Job<typeof data>);

    expect(pacingEngineService.adjustLesson).toHaveBeenCalledWith(data);
    expect(instructorAssistantService.generateWarmUp).toHaveBeenCalledWith({
      classroomId: 'classroom-1',
      lessonId: 'lesson-1',
    });
  });
});
