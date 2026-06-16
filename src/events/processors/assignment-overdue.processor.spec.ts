import { Job } from 'bullmq';
import { InstructorAssistantService } from '../../intelligence/instructor-assistant/instructor-assistant.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { AssignmentOverdueProcessor } from './assignment-overdue.processor';

describe('AssignmentOverdueProcessor', () => {
  it('generates instructor insight for overdue assignment jobs', async () => {
    const instructorAssistantService = {
      generateInsight: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<InstructorAssistantService>;
    const processor = new AssignmentOverdueProcessor(
      {} as NotificationsService,
      instructorAssistantService,
    );
    const data = {
      assignmentId: 'assignment-1',
      classroomId: 'classroom-1',
    };

    await processor.process({ data } as Job<typeof data>);

    expect(instructorAssistantService.generateInsight).toHaveBeenCalledWith({
      assignmentId: 'assignment-1',
      classroomId: 'classroom-1',
    });
  });
});
