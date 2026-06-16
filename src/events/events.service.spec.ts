import { Queue } from 'bullmq';
import { EventsService } from './events.service';
import { QUEUES } from './queues/queue.constants';

describe('EventsService', () => {
  let service: EventsService;
  let submissionQueue: jest.Mocked<Queue>;
  let overdueQueue: jest.Mocked<Queue>;
  let masteryQueue: jest.Mocked<Queue>;
  let attendanceQueue: jest.Mocked<Queue>;
  let engagementQueue: jest.Mocked<Queue>;

  const createQueue = (): jest.Mocked<Queue> =>
    ({ add: jest.fn().mockResolvedValue({}) }) as unknown as jest.Mocked<Queue>;

  beforeEach(() => {
    submissionQueue = createQueue();
    overdueQueue = createQueue();
    masteryQueue = createQueue();
    attendanceQueue = createQueue();
    engagementQueue = createQueue();
    service = new EventsService(
      submissionQueue,
      overdueQueue,
      masteryQueue,
      attendanceQueue,
      engagementQueue,
    );
  });

  it('routes submission.created events to the submission queue', async () => {
    const payload = {
      submissionId: 'submission-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
      classroomId: 'classroom-1',
    };

    await service.emit(QUEUES.SUBMISSION_CREATED, payload);

    expect(submissionQueue.add).toHaveBeenCalledWith(
      'process',
      payload,
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('routes every known event to its matching queue', async () => {
    await service.emit(QUEUES.ASSIGNMENT_OVERDUE, {
      assignmentId: 'assignment-1',
      classroomId: 'classroom-1',
    });
    await service.emit(QUEUES.MASTERY_DROP_DETECTED, {
      studentId: 'student-1',
      assignmentId: 'assignment-1',
      score: 70,
      maxScore: 100,
    });
    await service.emit(QUEUES.ATTENDANCE_RISK, {
      studentId: 'student-1',
      classroomId: 'classroom-1',
    });
    await service.emit(QUEUES.ENGAGEMENT_DROP, {
      studentId: 'student-1',
      classroomId: 'classroom-1',
    });

    expect(overdueQueue.add).toHaveBeenCalledTimes(1);
    expect(masteryQueue.add).toHaveBeenCalledTimes(1);
    expect(attendanceQueue.add).toHaveBeenCalledTimes(1);
    expect(engagementQueue.add).toHaveBeenCalledTimes(1);
  });

  it('falls back gracefully when Redis is unavailable', async () => {
    attendanceQueue.add.mockRejectedValue(new Error('Redis unavailable'));

    await expect(
      service.emit(QUEUES.ATTENDANCE_RISK, {
        studentId: 'student-1',
        classroomId: 'classroom-1',
      }),
    ).resolves.toBeUndefined();
  });
});
