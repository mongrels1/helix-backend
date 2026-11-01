import {
  datesFor,
  formatWeekRange,
  ildDay,
  noSchoolDay,
  resolveDays,
  suggestDayStatuses,
  weekOverview,
  weekdayIndex,
} from './lesson-plan.days';

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

describe('lesson-plan days (LP1)', () => {
  it('reads weekday names in their common forms', () => {
    expect(weekdayIndex('Monday')).toBe(0);
    expect(weekdayIndex('TUE')).toBe(1);
    expect(weekdayIndex('Day 3 (Wed)')).toBe(2);
    expect(weekdayIndex('Day 1')).toBeNull();
  });

  it('dates each day from the week start (Mon 2 Nov 2026)', () => {
    const r = resolveDays(WEEK, undefined, '2026-11-02');
    expect(r.map((d) => d.date)).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
    ]);
    expect(r[1].dateLabel).toBe('Tuesday, 3 Nov 2026');
    expect(formatWeekRange(r)).toBe('Nov 2–6, 2026');
  });

  it('dates unnamed days by position, and spans months and years in the header', () => {
    const d = datesFor(['Day 1', 'Day 2'], '2026-10-30');
    expect(d.map((x) => x?.toISOString().slice(0, 10))).toEqual(['2026-10-30', '2026-10-31']);
    expect(formatWeekRange(resolveDays(WEEK, undefined, '2026-10-26').slice(0, 1))).toBe('Oct 26, 2026');
    expect(formatWeekRange(resolveDays(['Thursday', 'Friday', 'Monday'], undefined, '2026-10-29'))).toBe(
      'Oct 29 – Nov 2, 2026',
    );
    expect(formatWeekRange(resolveDays(['Tuesday', 'Friday'], undefined, '2026-12-29'))).toBe(
      'Dec 29, 2026 – Jan 1, 2027',
    );
  });

  it('a bad or missing week start gives no dates, not wrong ones', () => {
    expect(resolveDays(WEEK, undefined, '2026-02-30')[0].date).toBeUndefined();
    expect(resolveDays(WEEK)[0].date).toBeUndefined();
  });

  it('legacy clients (days only) get every day as a teaching day', () => {
    expect(resolveDays(WEEK).every((d) => d.status === 'teach')).toBe(true);
  });

  it('matches day choices by name first, then by position', () => {
    const byName = resolveDays(WEEK, [{ name: 'tuesday', status: 'ild', reason: 'Election Day' }]);
    expect(byName.map((d) => d.status)).toEqual(['teach', 'ild', 'teach', 'teach', 'teach']);
    expect(byName[1].reason).toBe('Election Day');
    const byPos = resolveDays(WEEK, [{ status: 'teach' }, { status: 'no_school' }]);
    expect(byPos[1].status).toBe('no_school');
    const junk = resolveDays(WEEK, [{ name: 'Monday', status: 'party' as never }]);
    expect(junk[0].status).toBe('teach');
  });

  it('builds a no-school day in code that keeps its column and its segment count', () => {
    const [, tue] = resolveDays(WEEK, [{ name: 'Tuesday', status: 'no_school', reason: 'Election Day' }]);
    const day = noSchoolDay(tue, 3);
    expect(day.name).toBe('Tuesday');
    expect(day.status).toBe('no_school');
    expect(day.segments).toHaveLength(3);
    expect(day.standard).toBe('No school – Election Day.');
    expect(day.segments.every((s) => s.lesson_component === '')).toBe(true);
  });

  it('shapes an ILD draft: no class session, directions + assignment + answer key', () => {
    const [, tue] = resolveDays(WEEK, [{ name: 'Tuesday', status: 'ild' }], '2026-11-02');
    const day = ildDay(
      tue,
      {
        standard: '7.PAR.4.1',
        student_directions: '1. Open the worksheet.',
        assignment: '1) 3:12 unit rate',
        answer_key: '1) 0.25',
      },
      3,
    );
    expect(day.status).toBe('ild');
    expect(day.segments).toHaveLength(3);
    expect(day.segments.every((s) => s.teacher_actions === 'Independent learning day – no class session.')).toBe(true);
    expect(day.segments[0].student_actions).toContain('Assignment: 1) 3:12 unit rate');
    expect(day.segments[0].assessment_strategies).toBe('Answer key: 1) 0.25');
  });

  it('describes the whole week in one line for every day call', () => {
    const r = resolveDays(WEEK, [{ name: 'Tuesday', status: 'ild', reason: 'Election Day' }], '2026-11-02');
    const line = weekOverview(r);
    expect(line).toContain('Tuesday, 3 Nov 2026: independent learning day (no class session) (Election Day)');
    expect(line).toContain('Wednesday, 4 Nov 2026: teaching day');
  });

  describe('suggestions from the pacing guide', () => {
    const pacing = [
      'Week 12',
      'Nov 2  Safe Drinking Water task, 7.PAR.4.1',
      'Nov 3  ILD – Unit Rate ILD Worksheet',
      '11/4 Choice board / stations',
      'November 6: Professional Learning Day (no school for students)',
    ].join('\n');

    it('finds the ILD and the closure, with the line as evidence', () => {
      const s = suggestDayStatuses(WEEK, '2026-11-02', pacing);
      expect(s).toEqual([
        { name: 'Tuesday', date: '2026-11-03', status: 'ild', evidence: 'Nov 3 ILD – Unit Rate ILD Worksheet' },
        {
          name: 'Friday',
          date: '2026-11-06',
          status: 'no_school',
          evidence: 'November 6: Professional Learning Day (no school for students)',
        },
      ]);
    });

    it('does not confuse Nov 3 with Nov 30 or 11/30', () => {
      const s = suggestDayStatuses(WEEK, '2026-11-02', 'Nov 30 ILD\n11/30 holiday');
      expect(s).toEqual([]);
    });

    it('suggests nothing without a week start', () => {
      expect(suggestDayStatuses(WEEK, undefined, pacing)).toEqual([]);
    });
  });
});
