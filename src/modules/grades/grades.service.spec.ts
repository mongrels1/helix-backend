import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role, SubmissionStatus } from '@prisma/client';
import { GradesService } from './grades.service';

describe('GradesService', () => {
  let service: GradesService;
  let gradesRepo: {
    findBySubmission: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let submissionsRepo: { findById: jest.Mock };
  let masteryEngine: { updateMastery: jest.Mock };

  const submittedSubmission = {
    id: 'sub-1',
    studentId: 'student-1',
    status: SubmissionStatus.SUBMITTED,
    assignment: {
      id: 'assignment-1',
      maxScore: 100,
      skillTags: ['fractions'],
      classroomId: 'cls-1',
    },
  };
  const draftSubmission = {
    ...submittedSubmission,
    status: SubmissionStatus.DRAFT,
  };
  const existingGrade = {
    id: 'grade-1',
    submissionId: 'sub-1',
    score: 80,
    maxScore: 100,
    submission: { studentId: 'student-1' },
  };

  beforeEach(() => {
    gradesRepo = {
      findBySubmission: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    submissionsRepo = { findById: jest.fn() };
    masteryEngine = { updateMastery: jest.fn() };
    service = new GradesService(
      gradesRepo as never,
      submissionsRepo as never,
      masteryEngine as never,
    );
  });

  describe('create', () => {
    it('throws NotFoundException when submission does not exist', async () => {
      submissionsRepo.findById.mockResolvedValue(null);

      await expect(service.create({ submissionId: 'sub-1', score: 80 }, 'teacher-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when grade already exists', async () => {
      submissionsRepo.findById.mockResolvedValue(submittedSubmission);
      gradesRepo.findBySubmission.mockResolvedValue(existingGrade);

      await expect(service.create({ submissionId: 'sub-1', score: 80 }, 'teacher-1')).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException for DRAFT submission', async () => {
      submissionsRepo.findById.mockResolvedValue(draftSubmission);
      gradesRepo.findBySubmission.mockResolvedValue(null);

      await expect(service.create({ submissionId: 'sub-1', score: 80 }, 'teacher-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when score exceeds maxScore', async () => {
      submissionsRepo.findById.mockResolvedValue(submittedSubmission);
      gradesRepo.findBySubmission.mockResolvedValue(null);

      await expect(service.create({ submissionId: 'sub-1', score: 110 }, 'teacher-1')).rejects.toThrow(BadRequestException);
    });

    it('calls updateMastery for each skillTag after grading', async () => {
      submissionsRepo.findById.mockResolvedValue({
        ...submittedSubmission,
        assignment: {
          id: 'assignment-1',
          maxScore: 100,
          skillTags: ['fractions', 'decimals'],
          classroomId: 'cls-1',
        },
      });
      gradesRepo.findBySubmission.mockResolvedValue(null);
      gradesRepo.create.mockResolvedValue({
        score: 80,
        maxScore: 100,
        submissionId: 'sub-1',
        submission: { studentId: 'student-1' },
      });

      await service.create({ submissionId: 'sub-1', score: 80 }, 'teacher-1');

      expect(masteryEngine.updateMastery).toHaveBeenCalledTimes(2);
      expect(masteryEngine.updateMastery).toHaveBeenCalledWith(
        'student-1',
        'fractions',
        80,
        100,
        'sub-1',
        'cls-1',
      );
      expect(masteryEngine.updateMastery).toHaveBeenCalledWith(
        'student-1',
        'decimals',
        80,
        100,
        'sub-1',
        'cls-1',
      );
    });

    it('does not call updateMastery when skillTags is empty', async () => {
      submissionsRepo.findById.mockResolvedValue({
        ...submittedSubmission,
        assignment: {
          id: 'assignment-1',
          maxScore: 100,
          skillTags: [],
          classroomId: 'cls-1',
        },
      });
      gradesRepo.findBySubmission.mockResolvedValue(null);
      gradesRepo.create.mockResolvedValue({
        score: 80,
        maxScore: 100,
        submissionId: 'sub-1',
        submission: { studentId: 'student-1' },
      });

      await service.create({ submissionId: 'sub-1', score: 80 }, 'teacher-1');

      expect(masteryEngine.updateMastery).not.toHaveBeenCalled();
    });
  });

  describe('student access guard', () => {
    it('throws ForbiddenException when STUDENT views another student grade', async () => {
      gradesRepo.findById.mockResolvedValue({
        id: 'grade-1',
        submission: { studentId: 'student-999' },
      });

      await expect(service.findById('grade-1', { userId: 'student-1', role: Role.STUDENT })).rejects.toThrow(ForbiddenException);
    });

    it('allows TEACHER to view any grade', async () => {
      const grade = {
        id: 'grade-1',
        submission: { studentId: 'student-999' },
      };
      gradesRepo.findById.mockResolvedValue(grade);

      await expect(service.findById('grade-1', { userId: 'teacher-1', role: Role.TEACHER })).resolves.toBe(grade);
    });
  });
});
