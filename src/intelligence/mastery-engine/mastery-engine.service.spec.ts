import { MasteryEngineService } from './mastery-engine.service';

describe('MasteryEngineService', () => {
  let service: MasteryEngineService;
  let repository: {
    upsertScore: jest.Mock;
    getRecentHistory: jest.Mock;
    getAllScoresForStudent: jest.Mock;
    getScoreForSkill: jest.Mock;
    getClassroomMastery: jest.Mock;
  };
  let eventsService: { emit: jest.Mock };
  let aiRouterService: { chat: jest.Mock };

  beforeEach(() => {
    repository = {
      upsertScore: jest.fn(),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      getAllScoresForStudent: jest.fn(),
      getScoreForSkill: jest.fn(),
      getClassroomMastery: jest.fn(),
    };
    eventsService = { emit: jest.fn() };
    aiRouterService = { chat: jest.fn() };
    service = new MasteryEngineService(
      repository as never,
      eventsService as never,
      aiRouterService as never,
    );
  });

  describe('clampScore', () => {
    it('returns 0 for negative input', () => {
      expect((service as never as { clampScore: (score: number) => number }).clampScore(-0.5)).toBe(0);
    });

    it('returns 1 for input above 1', () => {
      expect((service as never as { clampScore: (score: number) => number }).clampScore(1.5)).toBe(1);
    });

    it('returns the value unchanged when between 0 and 1', () => {
      expect((service as never as { clampScore: (score: number) => number }).clampScore(0.75)).toBe(0.75);
    });

    it('handles maxScore of 0 without dividing by zero', () => {
      expect((service as never as { clampScore: (score: number) => number }).clampScore(0)).toBe(0);
    });
  });

  describe('calculateSlope', () => {
    it('returns negative slope for a declining series', () => {
      const slope = (service as never as { calculateSlope: (scores: number[]) => number }).calculateSlope([0.9, 0.7, 0.5, 0.3]);

      expect(slope).toBeLessThan(0);
    });

    it('returns positive slope for an improving series', () => {
      const slope = (service as never as { calculateSlope: (scores: number[]) => number }).calculateSlope([0.3, 0.5, 0.7, 0.9]);

      expect(slope).toBeGreaterThan(0);
    });

    it('returns 0 when all scores are equal', () => {
      const slope = (service as never as { calculateSlope: (scores: number[]) => number }).calculateSlope([0.5, 0.5, 0.5]);

      expect(slope).toBe(0);
    });

    it('returns 0 for a single score', () => {
      const slope = (service as never as { calculateSlope: (scores: number[]) => number }).calculateSlope([0.8]);

      expect(slope).toBe(0);
    });
  });

  describe('updateMastery', () => {
    it('normalises rawScore / maxScore before upsert', async () => {
      repository.upsertScore.mockResolvedValue(undefined);
      repository.getRecentHistory.mockResolvedValue([]);

      await service.updateMastery('student-1', 'fractions', 75, 100, 'sub-1');

      expect(repository.upsertScore).toHaveBeenCalledWith('student-1', 'fractions', 0.75, 'sub-1');
    });

    it('clamps score above 1 to 1', async () => {
      repository.upsertScore.mockResolvedValue(undefined);
      repository.getRecentHistory.mockResolvedValue([]);

      await service.updateMastery('student-1', 'fractions', 110, 100, 'sub-1');

      expect(repository.upsertScore).toHaveBeenCalledWith('student-1', 'fractions', 1, 'sub-1');
    });
  });
});
