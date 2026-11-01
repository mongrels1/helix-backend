/**
 * Integrity report (Verify Database page): Phase 0 honesty rules.
 * Before 1 Nov 2026 a bank whose answers could not be re-solved reported
 * "Clean … no defects" and READY. These tests pin the new behaviour.
 */
import { buildIntegrityReport, verificationOf, type BankRow, type DiagnosticRow } from './integrity';
import { judgeItem } from './item-judge';

const opt = (texts: string[], k: number) => texts.map((text, i) => ({ text, correct: i === k, misconceptionTag: i === k ? '' : 'distractor' }));

function row(id: string, stem: string, texts: string[], k: number, figure?: unknown): BankRow {
  return {
    id, status: 'validated', standard: 'MGSE7.G.4', ga: '7.GSR.7.1', gaCluster: '7.GSR.7',
    options: opt(texts, k), stem, answer: texts[k], solution: 'Step 1. Worked.', figure,
  };
}

// verified: the re-solver reads "length of … width of" and confirms 24
const VERIFIED = row('v1', 'A rectangle has a length of 8 cm and a width of 3 cm. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 0, { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' });
// unchecked: correct, but the wording is one the re-solver cannot read
const UNCHECKED = row('u1', 'A rectangle is 8 cm long and 3 cm wide. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 0, { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' });
const UNCHECKED2 = row('u2', 'Maya has 3 bags with 4 apples in each bag. How many apples does she have?', ['12', '7', '10', '15'], 0);
// failed: wrong key the re-solver does catch
const MISKEYED = row('f1', 'A rectangle has a length of 8 cm and a width of 3 cm. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 1, { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' });
// failed: figure numbers appear nowhere in the question (was a warning only)
const BAD_FIGURE = row('f2', 'A triangle has a base of 8 cm and a height of 5 cm. What is its area?', ['20 cm²', '40 cm²', '13 cm²', '30 cm²'], 0, { type: 'triangle', base: 10, height: 3, unit: 'cm', mode: 'area' });

describe('verificationOf', () => {
  it('verified only when the answer was independently re-solved and nothing failed', () => {
    expect(verificationOf(judgeItem(VERIFIED, 'practice'))).toBe('verified');
  });
  it('a correct item the re-solver cannot read is UNCHECKED, not verified', () => {
    expect(verificationOf(judgeItem(UNCHECKED, 'practice'))).toBe('unchecked');
  });
  it('a mis-keyed item fails', () => {
    expect(verificationOf(judgeItem(MISKEYED, 'practice'))).toBe('failed');
  });
  it('a figure whose numbers do not match the question fails (it was only a warning)', () => {
    expect(verificationOf(judgeItem(BAD_FIGURE, 'practice'))).toBe('failed');
  });
});

describe('integrity report: unchecked items no longer count as clean', () => {
  it('a bank where nothing could be checked is NOT ready (it used to say "Clean … no defects")', () => {
    const r = buildIntegrityReport([UNCHECKED, UNCHECKED2], []);
    const gen = r.banks.find((b) => b.key === 'generated')!;
    expect(gen.verification).toMatchObject({ total: 2, verified: 0, unchecked: 2, uncheckedPct: 100 });
    expect(gen.defects.find((d) => d.id === 'answer_not_checked')?.severity).toBe('blocker');
    expect(gen.verdict.ready).toBe(false);
    expect(gen.verdict.summary).toContain('Verified 0%');
    expect(r.combined.ready).toBe(false);
  });

  it('counts verified / failed / unchecked and states them in the summary', () => {
    const r = buildIntegrityReport([VERIFIED, UNCHECKED, MISKEYED, BAD_FIGURE], []);
    const gen = r.banks.find((b) => b.key === 'generated')!;
    expect(gen.verification).toMatchObject({ total: 4, verified: 1, failed: 2, unchecked: 1, verifiedPct: 25 });
    expect(gen.verdict.summary).toMatch(/^Verified 25% \(1 of 4\) · 2 failed · 1 not independently checked/);
    expect(r.combined.verification.verified).toBe(1);
  });

  it('a figure mismatch is a BLOCKER on the page now', () => {
    const r = buildIntegrityReport([VERIFIED, BAD_FIGURE], [], { maxUncheckedPct: 100 });
    const gen = r.banks.find((b) => b.key === 'generated')!;
    expect(gen.defects.find((d) => d.id === 'figure_unsound')?.severity).toBe('blocker');
    expect(gen.verdict.ready).toBe(false);
  });

  it('unchecked share at or under the limit is a warning, not a blocker', () => {
    const many = Array.from({ length: 19 }, (_, i) => ({ ...VERIFIED, id: `v${i}`, stem: `${VERIFIED.stem} (${i})` }));
    const r = buildIntegrityReport([...many, UNCHECKED], [], { maxUncheckedPct: 5 });
    const gen = r.banks.find((b) => b.key === 'generated')!;
    expect(gen.verification.uncheckedPct).toBe(5);
    expect(gen.defects.find((d) => d.id === 'answer_not_checked')?.severity).toBe('warning');
  });

  it('always says that figure values are not compared yet', () => {
    const r = buildIntegrityReport([VERIFIED], []);
    for (const b of r.banks) expect(b.defects.some((d) => d.id === 'figure_values_not_compared')).toBe(true);
  });

  it('the scored diagnostic bank reports figure mismatches, which it never did', () => {
    const diag: DiagnosticRow = {
      id: 'd1', grade: 6, strand: 'G', kc: 'Triangle area', standard: '6.GSR.5', dok: 2, b: 0, status: 'published',
      stem: 'A triangle has a base of 8 cm and a height of 5 cm. What is its area?', options: ['20 cm²', '40 cm²', '13 cm²', '30 cm²'], correct: 0,
      figure: { type: 'triangle', base: 10, height: 3, unit: 'cm', mode: 'area' },
    };
    const r = buildIntegrityReport([], [diag]);
    const d = r.banks.find((b) => b.key === 'diagnostic')!;
    expect(d.defects.find((x) => x.id === 'figure_unsound')?.severity).toBe('blocker');
    expect(d.verification.failed).toBe(1);
  });
});
