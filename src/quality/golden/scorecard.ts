/**
 * EdKairos · golden error suite · scorecard (PURE LOGIC)
 * ---------------------------------------------------------------------------
 * Runs every golden case through the REAL check it targets and reports what
 * actually happened. Used by the jest suite (golden.spec.ts) and by the CLI
 * (scorecard.cli.ts) that CI writes to the run summary.
 */
import type { GoldenCase, GoldenResult } from './golden.types';
import { ITEM_CASES, type ItemInput } from './item-cases';
import { LESSON_PLAN_CASES, type LessonPlanInput } from './lesson-plan-cases';
import { judgeItem } from '../../intelligence/item-generation/item-judge';
import {
  normaliseClassDay,
  checkUnitFacts,
  inventedFigures,
  resourceNumbers,
} from '../../intelligence/lesson-plan/lesson-plan.quality';

export function runItemCase(c: GoldenCase<ItemInput>): GoldenResult {
  const r = judgeItem(c.input.item, c.input.bank);
  const blocked = r.blockers.length > 0;
  const detail = blocked
    ? r.blockers.map((b) => b.id).join(', ')
    : r.warnings.length ? `served, warnings only: ${r.warnings.map((w) => w.id).join(', ')}` : 'served';
  return { id: c.id, area: 'questions', description: c.description, expect: c.expect, known: c.known, actual: blocked ? 'blocked' : 'clean', detail };
}

export function runLessonPlanCase(c: GoldenCase<LessonPlanInput>): GoldenResult {
  const inp = c.input;
  const source = resourceNumbers(inp.sourceText);
  let blocked = false;
  let detail = 'printed';
  if (inp.kind === 'lesson_text') {
    const flags = [...checkUnitFacts(inp.text), ...inventedFigures(inp.text, source)];
    blocked = flags.length > 0;
    if (blocked) detail = `flagged: ${flags.join('; ')}`;
  } else {
    const day =
      inp.kind === 'practice'
        ? { practice: [{ problem: inp.problem, answer: inp.answer, source: 'teacher upload' }] }
        : { worked_example: { problem: inp.problem, solution: inp.solution, source: 'teacher upload' } };
    const out = normaliseClassDay(day, source) as { teacher_notes: { practice: unknown[]; worked_example: unknown } };
    blocked = inp.kind === 'practice' ? out.teacher_notes.practice.length === 0 : out.teacher_notes.worked_example === null;
    if (blocked) detail = 'removed from the plan';
  }
  return { id: c.id, area: 'lesson plans', description: c.description, expect: c.expect, known: c.known, actual: blocked ? 'blocked' : 'clean', detail };
}

export function runAll(): GoldenResult[] {
  return [...ITEM_CASES.map(runItemCase), ...LESSON_PLAN_CASES.map(runLessonPlanCase)];
}

/** True when the case behaves as its fixture says it does today. */
export function behavesAsRecorded(r: GoldenResult): boolean {
  const correct = r.actual === r.expect;
  return r.known === 'caught' ? correct : !correct;
}

export interface AreaScore { area: string; total: number; caught: number; gaps: number; falseAlarms: number }

export function score(results: GoldenResult[]): AreaScore[] {
  const areas = [...new Set(results.map((r) => r.area))];
  return areas.map((area) => {
    const rs = results.filter((r) => r.area === area);
    return {
      area,
      total: rs.length,
      caught: rs.filter((r) => r.actual === r.expect).length,
      gaps: rs.filter((r) => r.actual !== r.expect && r.expect === 'blocked').length,
      falseAlarms: rs.filter((r) => r.actual !== r.expect && r.expect === 'clean').length,
    };
  });
}

/** Markdown scorecard for the CI run summary. */
export function scorecardMarkdown(results: GoldenResult[] = runAll()): string {
  const lines: string[] = [];
  lines.push('## EdKairos golden error suite');
  lines.push('');
  lines.push('Every known error, run through the real check. **Handled** = the check does the right thing.');
  lines.push('');
  lines.push('| Area | Cases | Handled | Missed errors | False alarms |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const s of score(results)) lines.push(`| ${s.area} | ${s.total} | ${s.caught} | ${s.gaps} | ${s.falseAlarms} |`);
  lines.push('');
  const open = results.filter((r) => r.actual !== r.expect);
  if (open.length) {
    lines.push('### Not handled yet');
    lines.push('');
    for (const r of open) lines.push(`- **${r.area}** · ${r.description} _(${r.detail})_`);
    lines.push('');
  }
  const drift = results.filter((r) => !behavesAsRecorded(r));
  if (drift.length) {
    lines.push('### ⚠ Changed since recorded');
    lines.push('');
    for (const r of drift) lines.push(`- \`${r.id}\`: recorded as ${r.known}, now ${r.actual === r.expect ? 'handled' : 'NOT handled'}`);
  }
  return lines.join('\n');
}
