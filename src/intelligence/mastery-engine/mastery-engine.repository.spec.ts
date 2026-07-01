import { Test, TestingModule } from '@nestjs/testing';
import { MasteryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasteryEngineRepository } from './mastery-engine.repository';

describe('MasteryEngineRepository', () => {
  let repository: MasteryEngineRepository;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((callback) => callback(prisma)),
      masteryScore: {
        upsert: jest.fn().mockResolvedValue({
          id: 'mastery-1',
          studentId: 'student-1',
          skillTag: 'fractions',
          score: 0.8,
          pMastered: 0.8,
          status: MasteryStatus.EMERGING,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      masteryHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasteryEngineRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    repository = module.get(MasteryEngineRepository);
  });

  it('upserts the posterior and appends an attempt-level history row', async () => {
    await repository.applyUpdate({
      studentId: 'student-1',
      skillTag: 'fractions',
      score: 0.8,
      pMastered: 0.8,
      correct: true,
      rigor: 2,
      variantKey: 'item-42',
      pAfter: 0.8,
      submissionId: 'submission-1',
      status: MasteryStatus.EMERGING,
      masteredAt: null,
      nextRecheckAt: null,
    });

    expect(prisma.masteryScore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId_skillTag: {
            studentId: 'student-1',
            skillTag: 'fractions',
          },
        },
        update: expect.objectContaining({ score: 0.8, pMastered: 0.8 }),
      }),
    );
    expect(prisma.masteryHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        masteryScoreId: 'mastery-1',
        score: 0.8,
        correct: true,
        rigor: 2,
        variantKey: 'item-42',
        pAfter: 0.8,
        submissionId: 'submission-1',
      }),
    });
  });
});
