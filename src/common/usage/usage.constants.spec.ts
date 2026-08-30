import {
  DAILY_ALLOWANCE,
  INTRO_ALLOWANCE,
  allowanceFor,
  dayKey,
  isIntroWindow,
} from './usage.constants';

describe('free-tier allowance', () => {
  it('is three a day, steady state', () => {
    expect(DAILY_ALLOWANCE.TUTOR).toBe(3);
    expect(DAILY_ALLOWANCE.PRACTICE).toBe(3);
  });

  it('gives a bigger first session', () => {
    // At three items a student can meet the wall in ninety seconds, and a wall
    // met before the product is seen teaches them the product IS a wall.
    const created = new Date('2026-08-30T10:00:00Z');
    const sameDay = new Date('2026-08-30T18:00:00Z');
    expect(isIntroWindow(created, sameDay)).toBe(true);
    expect(allowanceFor('TUTOR', created, sameDay)).toBe(INTRO_ALLOWANCE.TUTOR);
  });

  it('drops to the steady allowance after the intro window', () => {
    const created = new Date('2026-08-30T10:00:00Z');
    const twoDaysLater = new Date('2026-09-01T10:00:01Z');
    expect(isIntroWindow(created, twoDaysLater)).toBe(false);
    expect(allowanceFor('PRACTICE', created, twoDaysLater)).toBe(3);
  });

  it('keys the day in the business timezone, not UTC', () => {
    // 03:00 UTC on the 31st is still the 30th in America/New_York, so a student
    // practising at 11pm does not silently get a second allowance.
    expect(dayKey(new Date('2026-08-31T03:00:00Z'))).toBe('2026-08-30');
    expect(dayKey(new Date('2026-08-31T05:00:00Z'))).toBe('2026-08-31');
  });
});
