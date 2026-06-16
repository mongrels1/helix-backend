import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../../events/events.service';
import { AIRouterService } from '../ai-router/ai-router.service';
import { MasteryEngineRepository } from './mastery-engine.repository';
import { MasteryEngineService } from './mastery-engine.service';

describe('MasteryEngineService', () => {
  let service: MasteryEngineService;
  let repository: jest.Mocked<MasteryEngineRepository>;
  let eventsService: jest.Mocked<EventsService>;
  let aiRouterService: jest.Mocked<AIRouterService>;

  beforeEach(async () => {
    repository = {
      upsertScore: jest.fn(),
      getRecentHistory: jest.fn(),
      getAllScoresForStudent: jest.fn(),
      getScoreForSkill: jest.fn(),
      getClassroomMastery: jest.fn(),
    } as unknown as jest.Mocked<MasteryEngineRepository>;
    eventsService = { emit: jest.fn() } as unknown as jest.Mocked<EventsService>;
    aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: 'Teacher insight',
        provider: 'openai',
        tokensUsed: 8,
        latencyMs: 10,
      }),
    } as unknown as jest.Mocked<AIRouterService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasteryEngineService,
        { provide: MasteryEngineRepository, useValue: repository },
        { provide: EventsService, useValue: eventsService },
        { provide: AIRouterService, useValue: aiRouterService },
      ],
    }).compile();

    service = module.get(MasteryEngineService);
  });

  it('normalizes, clamps, and stores mastery updates', async () => {
    repository.upsertScore.mockResolvedValue({
      id: 'mastery-1',
      studentId: 'student-1',
      skillTag: 'fractions',
      score: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.getRecentHistory.mockResolvedValue([]);

    await service.updateMastery(
      'student-1',
      'fractions',
      120,
      100,
      'submission-1',
      'classroom-1',
    );

    expect(repository.upsertScore).toHaveBeenCalledWith(
      'student-1',
      'fractions',
      1,
      'submission-1',
    );
  });

  it('emits mastery.drop.detected for low declining scores', async () => {
    repository.upsertScore.mockResolvedValue({
      id: 'mastery-1',
      studentId: 'student-1',
      skillTag: 'fractions',
      score: 0.45,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.getRecentHistory.mockResolvedValue(
      [0.45, 0.55, 0.66, 0.75, 0.86].map((score, index) => ({
        id: `history-${index}`,
        masteryScoreId: 'mastery-1',
        score,
        submissionId: null,
        recordedAt: new Date(Date.now() - index),
      })),
    );

    await service.updateMastery(
      'student-1',
      'fractions',
      45,
      100,
      undefined,
      'classroom-1',
    );

    expect(aiRouterService.chat).toHaveBeenCalled();
    expect(eventsService.emit).toHaveBeenCalledWith(
      'mastery.drop.detected',
      expect.objectContaining({
        studentId: 'student-1',
        classroomId: 'classroom-1',
        skillTag: 'fractions',
        currentScore: 0.45,
        slope: expect.any(Number),
        insight: 'Teacher insight',
      }),
    );
    expect(eventsService.emit.mock.calls[0][1].slope).toBeLessThan(-0.05);
  });

  it('does not emit when the threshold is not met', async () => {
    repository.upsertScore.mockResolvedValue({
      id: 'mastery-1',
      studentId: 'student-1',
      skillTag: 'fractions',
      score: 0.7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.getRecentHistory.mockResolvedValue(
      [0.7, 0.72, 0.74].map((score, index) => ({
        id: `history-${index}`,
        masteryScoreId: 'mastery-1',
        score,
        submissionId: null,
        recordedAt: new Date(Date.now() - index),
      })),
    );

    await service.updateMastery('student-1', 'fractions', 70, 100);

    expect(eventsService.emit).not.toHaveBeenCalled();
  });

  it('falls back to a deterministic insight when AI fails', async () => {
    aiRouterService.chat.mockRejectedValue(new Error('No provider'));
    repository.upsertScore.mockResolvedValue({
      id: 'mastery-1',
      studentId: 'student-1',
      skillTag: 'fractions',
      score: 0.45,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    repository.getRecentHistory.mockResolvedValue(
      [0.45, 0.55, 0.66].map((score, index) => ({
        id: `history-${index}`,
        masteryScoreId: 'mastery-1',
        score,
        submissionId: null,
        recordedAt: new Date(Date.now() - index),
      })),
    );

    await service.updateMastery(
      'student-1',
      'fractions',
      45,
      100,
      undefined,
      'classroom-1',
    );

    expect(eventsService.emit).toHaveBeenCalledWith(
      'mastery.drop.detected',
      expect.objectContaining({
        classroomId: 'classroom-1',
        insight: 'Student is showing a declining mastery trend in this skill.',
      }),
    );
  });
});
