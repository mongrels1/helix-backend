import { resolveDays } from './lesson-plan.days';
import { checkArithmetic, checkUnitFacts, evalArithmetic, ildNotes, isAdapted, normaliseClassDay, weekRoles } from './lesson-plan.quality';

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

describe('lesson quality (LP4 + LP5)', () => {
  describe('week roles (R2)', () => {
    it('Nov 2-6 with Tue ILD and Fri test: Mon introduces, Thu reviews before the test, Fri assesses', () => {
      const r = resolveDays(
        WEEK,
        [
          { name: 'Tuesday', status: 'ild', reason: 'Election Day' },
          { name: 'Friday', status: 'test' },
        ],
        '2026-11-02',
      );
      const roles = weekRoles(r);
      expect(roles[1]).toEqual({}); // ILD: no class-day role
      expect(roles[0].position).toEqual({ k: 1, n: 4 });
      expect(roles[0].role).toMatch(/introduce/);
      expect(roles[2].before).toBe('Tuesday, 3 Nov 2026 is an independent learning day (no class session) (Election Day).');
      expect(roles[3].role).toBe('review and consolidate before the assessment on Friday, 6 Nov 2026');
      expect(roles[4].role).toMatch(/assess/);
      expect(roles[4].position).toEqual({ k: 4, n: 4 });
    });

    it('a plain five-day week: introduce, build, build, build, apply', () => {
      const roles = weekRoles(resolveDays(WEEK));
      expect(roles.map((x) => x.role?.split(' ')[0])).toEqual(['introduce', 'build:', 'build:', 'build:', 'apply']);
    });
  });

  describe('answer check (R4)', () => {
    it('evaluates arithmetic and refuses anything else', () => {
      expect(evalArithmetic('3 ÷ 12')).toBe(0.25);
      expect(evalArithmetic('(2 + 4) × 3')).toBe(18);
      expect(evalArithmetic('48 / 8 x 2')).toBe(12);
      expect(evalArithmetic('12')).toBeNull(); // no operator: not an equation side
      expect(evalArithmetic('3 apples ÷ 2')).toBeNull();
      expect(evalArithmetic('1 / 0')).toBeNull();
    });

    it('passes true equations, rounding included', () => {
      expect(checkArithmetic('3 ÷ 12 = 0.25; 2 ÷ 3 = 0.67; 6 × 18 = 108 cm²; 435 − 340 = 95')).toEqual([]);
      expect(checkArithmetic('3/8 = 0.375 and 0.4 - 0.375 = 0.025')).toEqual([]);
    });

    it('flags a wrong one with what it should be', () => {
      expect(checkArithmetic('So 3 ÷ 12 = 0.3 cups per cup')).toEqual(['3 ÷ 12 = 0.3 (we get 0.25)']);
    });

    it('ignores dates, ratios written with colons and plain numbers', () => {
      expect(checkArithmetic('Nov 2-6, 2026; ratio 3:5; answer is 95')).toEqual([]);
    });
  });

  describe('normaliseClassDay (R3)', () => {
    const drafted = {
      name: 'Wednesday',
      status: 'teach',
      standard: '7.PAR.4.1',
      where_this_fits: 'Uses Tuesday’s ILD worksheet to group students; sets up Thursday’s review.',
      academic_vocabulary: 'unit rate, ratio, per',
      writing_strategies: 'Sentence frame: "The unit rate is ___ per ___."',
      watch_for: [
        {
          misconception: 'Divides in the wrong order',
          looks_like: '12 ÷ 3 = 4 for "dirt per water" when the ratio is 3 dirt : 12 water',
          teacher_response: 'Ask: which quantity is "per one"? Put that one in the denominator.',
        },
        { misconception: 'Compares the parts, not the rates', looks_like: 'Says 3:12 is dirtier than 2:10 because 3 > 2', teacher_response: 'Compute both unit rates first.' },
      ],
      worked_example: { problem: '3 dirt : 12 water. Dirt per water?', solution: '3 ÷ 12 = 0.25 dirt per 1 water' },
      practice: [
        { problem: '2 : 10', answer: '2 ÷ 10 = 0.2' },
        { problem: '5 : 8', answer: '5 ÷ 8 = 0.6' },
        { problem: '7 : 4', answer: '7 ÷ 4 = 1.75' },
      ],
      segments: [
        { teacher_actions: 'A', differentiation: { ESOL: 'Support: frame' } },
        { teacher_actions: 'B', academic_vocabulary: 'own words' },
      ],
    };

    it('copies the day vocabulary and writing move into segments that lack them', () => {
      const out = normaliseClassDay(drafted) as { segments: Record<string, string>[] };
      expect(out.segments[0].academic_vocabulary).toBe('unit rate, ratio, per');
      expect(out.segments[0].writing_strategies).toContain('Sentence frame');
      expect(out.segments[1].academic_vocabulary).toBe('own words');
    });

    it('collects the four qualities into teacher_notes and leaves out the wrong practice answer', () => {
      const out = normaliseClassDay(drafted) as { teacher_notes: { checks: string[]; watch_for: unknown[]; practice: { problem: string }[] } };
      expect(out.teacher_notes.watch_for).toHaveLength(2);
      expect(out.teacher_notes.practice.map((p) => p.problem)).toEqual(['2 : 10', '7 : 4']);
      expect(out.teacher_notes.checks).toEqual(['1 practice problem removed: wrong answer, wrong unit fact or not from your resources.']);
      expect(out).not.toHaveProperty('watch_for');
      expect(out).not.toHaveProperty('practice');
    });

    it('survives a model that sends strings instead of objects', () => {
      const out = normaliseClassDay({ name: 'Mon', worked_example: 'Find 3 ÷ 4', practice: 'n/a', segments: [] }) as {
        teacher_notes: { worked_example: { problem: string }; practice: unknown[] };
      };
      expect(out.teacher_notes.worked_example.problem).toBe('Find 3 ÷ 4');
      expect(out.teacher_notes.practice).toEqual([]);
    });
  });

  it('ILD notes recheck the answer key', () => {
    expect(ildNotes('Answer key:\n1. 3 ÷ 12 = 0.25\n2. 2 ÷ 10 = 0.5').checks).toEqual(['Answer key: 2 ÷ 10 = 0.5 (we get 0.2). Fix before handing out.']);
  });
});

describe('answer check: equations with an unknown are not claimed results (Nov 9-13 plan)', () => {
  it('skips cross-multiplication steps', () => {
    expect(checkArithmetic('Cross-multiply: 12 × 20 = 8 × x. 240 = 8x. x = 240 ÷ 8 = 30 cups.')).toEqual([]);
    expect(checkArithmetic('Proportion: 450/3 = x/7. Cross-multiply: 450 × 7 = 3 × x. 3150 = 3x.')).toEqual([]);
    expect(checkArithmetic('Proportion: 24/6 = 60/x. 24x = 6 × 60 = 360.')).toEqual([]);
    expect(checkArithmetic('Proportion: 2,400/5 = 7,200/x.')).toEqual([]);
  });
  it('still catches a real slip next to them', () => {
    expect(checkArithmetic('12 × 20 = 8 × x, so 240 ÷ 8 = 32 cups')).toEqual(['240 ÷ 8 = 32 (we get 30)']);
  });
});

describe('stated misconceptions and sourced problems', () => {
  it('accepts one-sentence misconceptions and keeps each problem’s source', () => {
    const out = normaliseClassDay({
      name: 'Mon',
      watch_for: ['Divides ounces by gallons when the question asks gallons per ounce.', 'Adds instead of multiplying to extend a table.'],
      worked_example: { source: '2a Diagnostic Assessment', problem: '76 gal for 4 oz', solution: '76 ÷ 4 = 19' },
      practice: [{ source: '2a Student Reproducibles', problem: '2 oz?', answer: '2 × 19 = 38' }],
      segments: [],
    }) as { teacher_notes: { watch_for: { misconception: string }[]; worked_example: { source: string }; practice: { source: string }[] } };
    expect(out.teacher_notes.watch_for.map((w) => w.misconception)).toHaveLength(2);
    expect(out.teacher_notes.worked_example.source).toBe('2a Diagnostic Assessment');
    expect(out.teacher_notes.practice[0].source).toBe('2a Student Reproducibles');
  });
});

describe('LP11: nothing wrong or invented reaches the page (Nov 9-13, FILLED_7)', () => {
  it('a misconception sent as a string prints once, not three times', () => {
    const out = normaliseClassDay({ name: 'Mon', segments: [], watch_for: ['Divides in the wrong order.'] }) as {
      teacher_notes: { watch_for: { misconception: string; looks_like: string; teacher_response: string }[] };
    };
    expect(out.teacher_notes.watch_for).toEqual([{ misconception: 'Divides in the wrong order.', looks_like: '', teacher_response: '' }]);
  });

  it('flags wrong unit facts and passes right ones', () => {
    expect(checkUnitFacts('Since 2 ounces = 1 pound, the ratio is 2:1')).toEqual(['2 ounces = 1 pound (wrong unit fact)']);
    expect(checkUnitFacts('Using the pair (2 ounces, 1 pound): 1 ÷ 2')).toHaveLength(1);
    expect(checkUnitFacts('16 ounces = 1 pound; 2 ounces = 0.125 pounds; 1/2 pound is 8 ounces; 4 quarts = 1 gallon')).toEqual([]);
    expect(checkUnitFacts('76 gallons to produce 4 ounces of oatmeal; 3 servings, 660 gallons')).toEqual([]);
  });

  it('recognises invented "adapted" items', () => {
    expect(isAdapted('2b Classifying-Proportion-...-Student-Reproducibles (adapted)')).toBe(true);
    expect(isAdapted('2a ... (Water Footprint Meal Plan, Part 2, adapted from question 6)')).toBe(true);
    expect(isAdapted('2a ... (Diagnostic Assessment)')).toBe(false);
  });

  it('Tuesday: wrong answers and a wrong unit fact are left out; the worked example is replaced by a good practice item', () => {
    const out = normaliseClassDay({
      name: 'Tuesday',
      segments: [],
      worked_example: { source: 'Water Footprint of Products, q1-4', problem: 'Ounces to pounds table', solution: 'Since 2 ounces = 1 pound, divide by 2.' },
      practice: [
        { source: 'q5-7', problem: 'Pounds to ounces table', answer: '1/4 × 16 = 4; 3 × 16 = 12; 6 × 16 = 24' },
        { source: 'q8', problem: 'How are the constants related?', answer: 'Reciprocals: multiply by 16 or by 1/16.' },
        { source: 'Meal Plan (adapted)', problem: 'Chicken: 1040 gallons per serving', answer: '1040 ÷ 1 = 1040' },
      ],
    }) as { teacher_notes: { worked_example: { problem: string } | null; practice: unknown[]; checks: string[] } };
    expect(out.teacher_notes.worked_example?.problem).toBe('How are the constants related?');
    expect(out.teacher_notes.practice).toEqual([]);
    expect(out.teacher_notes.checks).toEqual(['2 practice problems removed: wrong answer, wrong unit fact or not from your resources.']);
  });
});
