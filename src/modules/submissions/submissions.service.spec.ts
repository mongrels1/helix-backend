import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role, SubmissionStatus } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { AssignmentsRepository } from '../assignments/assignments.repository';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

describe('SubmissionsService', () => {
  let service: SubmissionsService;
  let submissionsRepository: jest.Mocked<SubmissionsRepository>;
  let assignmentsRepository: jest.Mocked<AssignmentsRepository>;
  let eventsService: jest.Mocked<EventsService>;

  const submission = {
    id: 'submission-1',
    assignmentId: 'assignment-1',
    studentId: 'student-1',
    status: SubmissionStatus.DRAFT,
    content: 'Draft',
    fileUrl: null,
    submittedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    submissionsRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByAssignmentAndStudent: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      submit: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<SubmissionsRepository>;
    assignmentsRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<AssignmentsRepository>;
    eventsService = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventsService>;
    service = new SubmissionsService(
      submissionsRepository,
      assignmentsRepository,
      eventsService,
    );
  });

  it('creates a draft submission for a student', async () => {
    assignmentsRepository.findById.mockResolvedValue({ id: 'assignment-1' } as any);
    submissionsRepository.findByAssignmentAndStudent.mockResolvedValue(null);
    submissionsRepository.create.mockResolvedValue(submission);

    await expect(
      service.create(
        { assignmentId: 'assignment-1', content: 'Draft' },
        'student-1',
        Role.STUDENT,
      ),
    ).resolves.toEqual(submission);
  });

  it('rejects duplicate submissions', async () => {
    assignmentsRepository.findById.mockResolvedValue({ id: 'assignment-1' } as any);
    submissionsRepository.findByAssignmentAndStudent.mockResolvedValue(submission);

    await expect(
      service.create({ assignmentId: 'assignment-1' }, 'student-1', Role.STUDENT),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects non-students creating submissions', async () => {
    await expect(
      service.create({ assignmentId: 'assignment-1' }, 'teacher-1', Role.TEACHER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing assignments', async () => {
    assignmentsRepository.findById.mockResolvedValue(null);

    await expect(
      service.create({ assignmentId: 'missing' }, 'student-1', Role.STUDENT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents editing submitted work', async () => {
    submissionsRepository.findById.mockResolvedValue({
      ...submission,
      status: SubmissionStatus.SUBMITTED,
    });

    await expect(
      service.update('submission-1', { content: 'Changed' }, 'student-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submits drafts and emits submission.created', async () => {
    const submitted = {
      ...submission,
      status: SubmissionStatus.SUBMITTED,
      submittedAt: new Date(),
    };
    submissionsRepository.findById.mockResolvedValue(submission);
    submissionsRepository.submit.mockResolvedValue(submitted);

    await expect(service.submit('submission-1', 'student-1')).resolves.toEqual(
      submitted,
    );
    expect(eventsService.emit).toHaveBeenCalledWith('submission.created', {
      submissionId: 'submission-1',
      assignmentId: 'assignment-1',
      studentId: 'student-1',
    });
  });
});
