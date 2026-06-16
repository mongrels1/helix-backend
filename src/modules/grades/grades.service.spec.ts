import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { MasteryEngineService } from '../../intelligence/mastery-engine/mastery-engine.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { GradesRepository } from './grades.repository';
import { GradesService } from './grades.service';

describe('GradesService', () => {
  let service: GradesService;
  let gradesRepository: jest.Mocked<GradesRepository>;
  let submissionsRepository: jest.Mocked<SubmissionsRepository>;
  let masteryEngineService: jest.Mocked<MasteryEngineService>;

  const submission = {
    id: 'submission-1',
    assignmentId: 'assignment-1',
    studentId: 'student-1',
    status: SubmissionStatus.SUBMITTED,
    content: 'Work',
    fileUrl: null,
    submittedAt: new Date(),
    assignment: {
      id: 'assignment-1',
      classroomId: 'classroom-1',
      maxScore: 100,
      skillTags: ['fractions'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const grade = {
    id: 'grade-1',
    submissionId: 'submission-1',
    score: 85,
    maxScore: 100,
    feedback: 'Good',
    gradedById: 'teacher-1',
    submission: { assignmentId: 'assignment-1', studentId: 'student-1' },
    history: [
      {
        id: 'history-1',
        score: 85,
        maxScore: 100,
        feedback: 'Good',
        changedById: 'teacher-1',
        createdAt: new Date(),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    gradesRepository = {
      findBySubmission: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<GradesRepository>;
    submissionsRepository = {
      findById: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<SubmissionsRepository>;
    masteryEngineService = {
      updateMastery: jest.fn(),
    } as unknown as jest.Mocked<MasteryEngineService>;
    service = new GradesService(
      gradesRepository,
      submissionsRepository,
      masteryEngineService,
    );
  });

  it('creates a grade and updates mastery for assignment skills', async () => {
    submissionsRepository.findById.mockResolvedValue(submission as any);
    gradesRepository.create.mockResolvedValue(grade as any);

    await expect(
      service.create(
        { submissionId: 'submission-1', score: 85, feedback: 'Good' },
        'teacher-1',
      ),
    ).resolves.toEqual(grade);
    expect(masteryEngineService.updateMastery).toHaveBeenCalledWith(
      'student-1',
      'fractions',
      85,
      100,
      'submission-1',
      'classroom-1',
    );
  });

  it('rejects missing submissions', async () => {
    submissionsRepository.findById.mockResolvedValue(null);

    await expect(
      service.create({ submissionId: 'missing', score: 85 }, 'teacher-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects draft submissions', async () => {
    submissionsRepository.findById.mockResolvedValue({
      ...submission,
      status: SubmissionStatus.DRAFT,
    } as any);

    await expect(
      service.create({ submissionId: 'submission-1', score: 85 }, 'teacher-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects scores above maxScore', async () => {
    submissionsRepository.findById.mockResolvedValue(submission as any);

    await expect(
      service.create({ submissionId: 'submission-1', score: 101 }, 'teacher-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('propagates duplicate grade conflicts', async () => {
    submissionsRepository.findById.mockResolvedValue(submission as any);
    gradesRepository.create.mockRejectedValue(
      new ConflictException('Grade already exists for this submission'),
    );

    await expect(
      service.create({ submissionId: 'submission-1', score: 85 }, 'teacher-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates a grade and updates mastery for assignment skills', async () => {
    gradesRepository.findById.mockResolvedValue(grade as any);
    gradesRepository.update.mockResolvedValue({ ...grade, score: 90 } as any);
    submissionsRepository.findById.mockResolvedValue(submission as any);

    await expect(
      service.update('grade-1', { score: 90 }, 'teacher-2'),
    ).resolves.toMatchObject({ score: 90 });
    expect(masteryEngineService.updateMastery).toHaveBeenCalledWith(
      'student-1',
      'fractions',
      90,
      100,
      'submission-1',
      'classroom-1',
    );
  });
});
