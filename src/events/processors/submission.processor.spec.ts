import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { MasteryEngineService } from '../../intelligence/mastery-engine/mastery-engine.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionProcessor } from './submission.processor';

describe('SubmissionProcessor', () => {
  it('updates mastery for each assignment skill tag', async () => {
    const masteryEngineService = { updateMastery: jest.fn() };
    const prisma = {
      assignment: {
        findUnique: jest.fn().mockResolvedValue({
          skillTags: ['fractions', 'ratios'],
          maxScore: 100,
        }),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionProcessor,
        { provide: NotificationsService, useValue: {} },
        { provide: MasteryEngineService, useValue: masteryEngineService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    const processor = module.get(SubmissionProcessor);
    await processor.process({
      data: {
        submissionId: 'submission-1',
        assignmentId: 'assignment-1',
        studentId: 'student-1',
        classroomId: 'classroom-1',
        score: 80,
      },
    } as Job);

    expect(masteryEngineService.updateMastery).toHaveBeenCalledTimes(2);
    expect(masteryEngineService.updateMastery).toHaveBeenCalledWith(
      'student-1',
      'fractions',
      80,
      100,
      'submission-1',
      'classroom-1',
    );
  });
});
