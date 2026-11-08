import { practiceBand, schoolWeek } from './report-week';

describe('schoolWeek', () => {
  it('snaps any day to Monday–Sunday, school time', () => {
    const w = schoolWeek('2026-11-12'); // Thursday
    expect(w.start).toBe('2026-11-09');
    expect(w.end).toBe('2026-11-15');
    expect(w.days).toHaveLength(7);
    expect(w.startUtc.toISOString()).toBe('2026-11-09T05:00:00.000Z'); // EST
    expect(w.endUtc.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });

  it('uses the school date, not UTC, for "this week"', () => {
    // Sunday 8 Nov 2026, 11:30 pm ET is already Monday in UTC.
    const w = schoolWeek(undefined, new Date('2026-11-09T04:30:00Z'));
    expect(w.start).toBe('2026-11-02');
  });

  it('handles the DST change week', () => {
    const w = schoolWeek('2026-11-01'); // DST ends Sun 1 Nov
    expect(w.start).toBe('2026-10-26');
    expect(w.startUtc.toISOString()).toBe('2026-10-26T04:00:00.000Z'); // EDT
    expect(w.endUtc.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // EST
  });

  it('ignores a bad week value', () => {
    const now = new Date('2026-11-11T15:00:00Z');
    expect(schoolWeek('2026-02-31', now).start).toBe('2026-11-09');
    expect(schoolWeek('junk', now).start).toBe('2026-11-09');
  });
});

describe('practiceBand', () => {
  it('bands minutes against the goal', () => {
    expect(practiceBand(0, 180, false)).toBe('none');
    expect(practiceBand(0, 180, true)).toBe('low');
    expect(practiceBand(59, 180, true)).toBe('low');
    expect(practiceBand(60, 180, true)).toBe('partway');
    expect(practiceBand(180, 180, true)).toBe('met');
  });
});
