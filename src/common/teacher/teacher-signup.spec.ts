import {
  isApprovedTeacherEmail,
  lessonPlanWeekKey,
  weeklyLessonPlanAllowance,
} from './teacher-signup';

describe('teacher signup', () => {
  const env = { TEACHER_SIGNUP_DOMAINS: 'school.org' } as NodeJS.ProcessEnv;

  it('accepts a plain school address', () => {
    expect(isApprovedTeacherEmail('a.teacher@school.org', env)).toBe(true);
  });
  it('refuses a + alias on an approved domain', () => {
    expect(isApprovedTeacherEmail('a.teacher+2@school.org', env)).toBe(false);
  });
  it('still accepts a + alias listed exactly in TEACHER_SIGNUP_EMAILS', () => {
    const e = { ...env, TEACHER_SIGNUP_EMAILS: 'a.teacher+test1@school.org' };
    expect(isApprovedTeacherEmail('A.Teacher+test1@school.org', e)).toBe(true);
  });
  it('defaults to 1 plan a week, overridable', () => {
    expect(weeklyLessonPlanAllowance({} as NodeJS.ProcessEnv)).toBe(1);
    expect(weeklyLessonPlanAllowance({ TEACHER_FREE_WEEKLY_LESSON_PLANS: '2' } as NodeJS.ProcessEnv)).toBe(2);
  });
  it('keys a week by its Monday in Eastern time', () => {
    // Sat 31 Oct 2026 14:00 ET -> Mon 26 Oct
    expect(lessonPlanWeekKey(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10-26');
    // Mon 2 Nov 2026 00:30 ET (05:30 UTC, EST) -> 2 Nov
    expect(lessonPlanWeekKey(new Date('2026-11-02T05:30:00Z'))).toBe('2026-11-02');
    // Sun 1 Nov 2026 23:30 ET -> still 26 Oct
    expect(lessonPlanWeekKey(new Date('2026-11-02T04:30:00Z'))).toBe('2026-10-26');
  });
});
