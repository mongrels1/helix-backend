import { buildLessonDayPrompt, extractJson, repairJsonSlips } from './lesson-plan.prompt';

/** Replies seen failing on 1 Nov 2026: complete (end_turn), 14-20k characters, not valid JSON. */
describe('extractJson repairs common model slips', () => {
  it('an unescaped quote inside a string', () => {
    const bad = '```json\n{"days":[{"name":"Tue","teacher_actions":"Say: "per" means for each one. Then divide."}]}\n```';
    expect(extractJson(bad)).toEqual({ days: [{ name: 'Tue', teacher_actions: 'Say: "per" means for each one. Then divide.' }] });
  });

  it('a raw line break inside a string and a trailing comma', () => {
    const bad = '{"days":[{"name":"Wed","practice":[{"problem":"1) 4:16\n2) 2:10","answer":"0.25",},],}]}';
    expect(extractJson(bad)).toEqual({ days: [{ name: 'Wed', practice: [{ problem: '1) 4:16\n2) 2:10', answer: '0.25' }] }] });
  });

  it('leaves valid JSON exactly as it was', () => {
    const ok = '{"a":"He said \\"hi\\", then left","b":[1,2]}';
    expect(repairJsonSlips(ok)).toBe(ok);
    expect(extractJson(ok)).toEqual({ a: 'He said "hi", then left', b: [1, 2] });
  });
});

describe('Small Group is written once per week', () => {
  const cfg = { period_minutes: 55, days: ['Tuesday'], segments_per_day: 3, differentiation_groups: ['ESOL'] };
  it('the first class day asks for it; other days are told not to', () => {
    expect(buildLessonDayPrompt(cfg, { includeSmallGroup: true })).toContain('"small_group"');
    const other = buildLessonDayPrompt(cfg, { includeSmallGroup: false });
    expect(other).not.toContain('"small_group"');
    expect(other).toContain('Do not write a small_group section');
  });
});

describe('resources only, misconceptions stated (John, 1 Nov 2026)', () => {
  const cfg = { period_minutes: 55, days: ['Monday'], segments_per_day: 3, differentiation_groups: ['ESOL'] };
  const p = buildLessonDayPrompt(cfg, {});
  it('no outside or hypothetical contexts are suggested', () => {
    expect(p).not.toMatch(/hypothetical|store price|machine rate|recipe uses/i);
    expect(p).toContain("USE THE TEACHER'S RESOURCES");
  });
  it('misconceptions are one sentence each, with no invented wrong work', () => {
    expect(p).toContain('stated in ONE plain sentence');
    expect(p).not.toContain('looks_like');
  });
});
