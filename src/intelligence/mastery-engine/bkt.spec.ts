import {
  BKT_DEFAULTS,
  MASTERY_THRESHOLD,
  REQUIRED_VARIANTS,
  bktUpdate,
  decayedPosterior,
  evaluateGate,
  opportunitiesToThreshold,
  rigorCovered,
} from './bkt';

describe('BKT core', () => {
  describe('bktUpdate', () => {
    it('raises the posterior on a correct response', () => {
      expect(bktUpdate(0.25, true)).toBeGreaterThan(0.25);
    });

    it('lowers the posterior on an incorrect response (relative to learning gain)', () => {
      const prior = 0.7;
      expect(bktUpdate(prior, false)).toBeLessThan(prior);
    });

    it('keeps the posterior within [0, 1]', () => {
      let p = 0.5;
      for (let i = 0; i < 20; i += 1) p = bktUpdate(p, i % 2 === 0);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });

    it('a single correct answer does not reach mastery from the default prior', () => {
      expect(bktUpdate(BKT_DEFAULTS.pL0, true)).toBeLessThan(MASTERY_THRESHOLD);
    });

    it('roughly four consecutive corrects cross the mastery threshold', () => {
      let p = BKT_DEFAULTS.pL0;
      let n = 0;
      while (p < MASTERY_THRESHOLD && n < 10) {
        p = bktUpdate(p, true);
        n += 1;
      }
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    });
  });

  describe('evaluateGate', () => {
    it('does not lock when confidence is high but breadth is missing', () => {
      const gate = evaluateGate({
        pMastered: 0.99,
        variantsCorrect: 1,
        rigorLevels: [],
      });
      expect(gate.confidenceMet).toBe(true);
      expect(gate.breadthMet).toBe(false);
      expect(gate.mastered).toBe(false);
      expect(gate.remainingToLock).toBeGreaterThan(0);
    });

    it('locks only when confidence, breadth, and rigor are all met', () => {
      const gate = evaluateGate({
        pMastered: 0.96,
        variantsCorrect: REQUIRED_VARIANTS,
        rigorLevels: [1, 2, 3],
      });
      expect(gate.mastered).toBe(true);
      expect(gate.remainingToLock).toBe(0);
    });
  });

  describe('rigorCovered', () => {
    it('is satisfied when rigor is untagged (no data held against the learner)', () => {
      expect(rigorCovered([])).toBe(true);
    });

    it('requires at least two distinct rigor levels when tagged', () => {
      expect(rigorCovered([2, 2, 2])).toBe(false);
      expect(rigorCovered([1, 3])).toBe(true);
    });
  });

  describe('opportunitiesToThreshold', () => {
    it('is zero when already at threshold', () => {
      expect(opportunitiesToThreshold(0.96)).toBe(0);
    });

    it('is positive from a cold start', () => {
      expect(opportunitiesToThreshold(BKT_DEFAULTS.pL0)).toBeGreaterThan(0);
    });
  });

  describe('decayedPosterior', () => {
    it('regresses a high posterior back toward the prior', () => {
      const decayed = decayedPosterior(0.97);
      expect(decayed).toBeLessThan(0.97);
      expect(decayed).toBeGreaterThan(BKT_DEFAULTS.pL0);
    });
  });
});
