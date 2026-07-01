import { MasteryStatus } from '@prisma/client';
import { MasteryEngineService } from './mastery-engine.service';
import { BKT_DEFAULTS, MASTERY_THRESHOLD } from './bkt';

describe('MasteryEngineService', () => {
  let service: MasteryEngineService;
  let repository: {
    applyUpdate: jest.Mock;
    updateStatusFields: jest.Mock;
    applyDecay: jest.Mock;
    getCorrectHistory: jest.Mock;
    getRecentHistory: jest.Mock;
    getAllScoresForStudent: jest.Mock;
    getScoreForSkill: jest.Mock;
    getClassroomMastery: jest.Mock;
  };
  let eventsService: { emit: jest.Mock };
  let aiRouterService: { chat: jest.Mock };

  beforeEach(() => {
    repository = {
      applyUpdate: jest.fn().mockResolvedValue({ id: 'm1' }),
      updateStatusFields: jest.fn().mockResolvedValue(undefined),
      applyDecay: jest.fn(),
      getCorrectHistory: jest.fn().mockResolvedValue([]),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      getAllScoresForStudent: jest.fn(),
      getScoreForSkill: jest.fn().mockResolvedValue(null),
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

  describe('calculateSlope', () => {
    it('returns negative slope for a declining series', () => {
      const slope = (
        service as never as { calculateSlope: (s: number[]) => number }
      ).calculateSlope([0.9, 0.7, 0.5, 0.3]);
      expect(slope).toBeLessThan(0);
    });

    it('returns 0 when all scores are equal', () => {
      const slope = (
        service as never as { calculateSlope: (s: number[]) => number }
      ).calculateSlope([0.5, 0.5, 0.5]);
      expect(slope).toBe(0);
    });
  });

  describe('updateMastery (BKT)', () => {
    it('raises the posterior on a correct response and records the attempt', async () => {
      await service.updateMastery('student-1', 'fractions', 1, 1, 'sub-1');

      expect(repository.applyUpdate).toHaveBeenCalled();
      const call = repository.applyUpdate.mock.calls[0][0];
      expect(call.correct).toBe(true);
      // From the P(L0)=0.25 prior, one correct must move the posterior UP...
      expect(call.pMastered).toBeGreaterThan(BKT_DEFAULTS.pL0);
      // ...but a single correct answer must NOT reach the mastery threshold.
      expect(call.pMastered).toBeLessThan(MASTERY_THRESHOLD);
    });

    it('lowers the posterior on an incorrect response', async () => {
      repository.getScoreForSkill.mockResolvedValue({
        id: 'm1',
        studentId: 'student-1',
        skillTag: 'fractions',
        score: 0.7,
        pMastered: 0.7,
        status: MasteryStatus.EMERGING,
        masteredAt: null,
        nextRecheckAt: null,
      });

      await service.updateMastery('student-1', 'fractions', 0, 1, 'sub-2');

      const call = repository.applyUpdate.mock.calls[0][0];
      expect(call.correct).toBe(false);
      expect(call.pMastered).toBeLessThan(0.7);
    });

    it('does not lock a skill on a single correct answer (breadth gate)', async () => {
      // One correct attempt in history => breadth not met => not mastered.
      repository.getCorrectHistory.mockResolvedValue([
        { id: 'h1', variantKey: 'v1', rigor: null },
      ]);

      await service.updateMastery('student-1', 'fractions', 1, 1, 'sub-1');

      const statuses = repository.applyUpdate.mock.calls.map((c) => c[0].status);
      expect(statuses).not.toContain(MasteryStatus.MASTERED);
    });
  });

  describe('getMasteryGate', () => {
    it('reports remaining opportunities to lock for a fresh skill', async () => {
      const gate = await service.getMasteryGate('student-1', 'fractions');
      expect(gate.mastered).toBe(false);
      expect(gate.remainingToLock).toBeGreaterThan(0);
      expect(gate.variantsRequired).toBeGreaterThan(0);
    });
  });
});
