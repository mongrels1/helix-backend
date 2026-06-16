import { Test, TestingModule } from '@nestjs/testing';
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

  it('upserts mastery score and appends a history row', async () => {
    await repository.upsertScore('student-1', 'fractions', 0.8, 'submission-1');

    expect(prisma.masteryScore.upsert).toHaveBeenCalledWith({
      where: {
        studentId_skillTag: {
          studentId: 'student-1',
          skillTag: 'fractions',
        },
      },
      update: { score: 0.8 },
      create: {
        studentId: 'student-1',
        skillTag: 'fractions',
        score: 0.8,
      },
    });
    expect(prisma.masteryHistory.create).toHaveBeenCalledWith({
      data: {
        masteryScoreId: 'mastery-1',
        score: 0.8,
        submissionId: 'submission-1',
      },
    });
  });
});
