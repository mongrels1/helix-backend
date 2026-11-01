/**
 * EdKairos golden error suite.
 *
 * A 'caught' case failing here means a check REGRESSED: something that used to
 * be stopped now gets through (or a correct item is now wrongly rejected).
 *
 * A 'gap' case failing here is GOOD NEWS: a check now handles an error it used
 * to miss. Change that case's `known` from 'gap' to 'caught' in its fixture
 * file, so it can never quietly regress again.
 *
 * Do not change `expect`, and do not delete a case to make this pass.
 */
import { ITEM_CASES } from './item-cases';
import { LESSON_PLAN_CASES } from './lesson-plan-cases';
import { runItemCase, runLessonPlanCase, runAll, score, scorecardMarkdown } from './scorecard';
import type { GoldenResult } from './golden.types';

function check(r: GoldenResult) {
  const handled = r.actual === r.expect;
  if (r.known === 'caught' && !handled) {
    throw new Error(`REGRESSION · ${r.id}: "${r.description}" was handled and no longer is (actual: ${r.actual}; ${r.detail}).`);
  }
  if (r.known === 'gap' && handled) {
    throw new Error(`NOW HANDLED · ${r.id}: "${r.description}". Change known: 'gap' to known: 'caught' in its fixture.`);
  }
}

describe('golden error suite · questions (item judge)', () => {
  it.each(ITEM_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => check(runItemCase(c)));
});

describe('golden error suite · lesson plans (quality checks)', () => {
  it.each(LESSON_PLAN_CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => check(runLessonPlanCase(c)));
});

describe('golden error suite · the fixtures themselves', () => {
  const all = [...ITEM_CASES, ...LESSON_PLAN_CASES];

  it('every case has a unique id', () => {
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case names its source and describes the error', () => {
    for (const c of all) {
      expect(c.source.trim()).not.toBe('');
      expect(c.description.trim().length).toBeGreaterThan(10);
    }
  });

  it('includes correct items (controls), so a check that blocks everything cannot pass', () => {
    expect(all.filter((c) => c.expect === 'clean').length).toBeGreaterThanOrEqual(5);
  });

  it('the scorecard renders and counts every case', () => {
    const results = runAll();
    const total = score(results).reduce((n, s) => n + s.total, 0);
    expect(total).toBe(all.length);
    expect(scorecardMarkdown(results)).toContain('EdKairos golden error suite');
  });
});
