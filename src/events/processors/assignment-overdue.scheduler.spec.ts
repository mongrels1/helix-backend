import { AssignmentsRepository } from '@modules/assignments/assignments.repository';
import { EventsService } from '../events.service';
import { QUEUES } from '../queues/queue.constants';
import { AssignmentOverdueScheduler } from './assignment-overdue.scheduler';

describe('AssignmentOverdueScheduler', () => {
  it('enqueues overdue assignments', async () => {
    const eventsService = {
      emit: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EventsService>;
    const assignmentsRepository = {
      findOverdue: jest.fn().mockResolvedValue([
        {
          id: 'assignment-1',
          classroomId: 'classroom-1',
        },
      ]),
    } as unknown as jest.Mocked<AssignmentsRepository>;
    const scheduler = new AssignmentOverdueScheduler(
      eventsService,
      assignmentsRepository,
    );

    await scheduler.checkOverdueAssignments();

    expect(eventsService.emit).toHaveBeenCalledWith(QUEUES.ASSIGNMENT_OVERDUE, {
      assignmentId: 'assignment-1',
      classroomId: 'classroom-1',
    });
  });
});
