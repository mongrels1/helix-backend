import { masteryValueForTag } from './diagnostic-mastery';
import { CORRECT_THRESHOLD } from '../mastery-engine/bkt';

describe('masteryValueForTag', () => {
  it('a missed harder question (emerging) counts as a miss, not a pass', () => {
    expect(masteryValueForTag('emerging')!).toBeLessThan(CORRECT_THRESHOLD);
    expect(masteryValueForTag('emerging')!).toBeLessThan(0.6); // the diagnostic's gap line
    expect(masteryValueForTag('emerging')!).toBeGreaterThan(masteryValueForTag('notyet')!);
  });
  it('correct = 1, stretch is not scored', () => {
    expect(masteryValueForTag('mastered')).toBe(1);
    expect(masteryValueForTag('stretch')).toBeNull();
  });
});
