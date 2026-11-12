import { measuredByKc, plan } from './reapply-latest-diagnostic';

describe('reapply-latest-diagnostic', () => {
  const measured = measuredByKc([
    { kc: 'Area of a circle', tag: 'not-yet' },
    { kc: 'Area of a circle', tag: 'mastered' },      // mean 0.575 -> weak
    { kc: 'Compare decimals', tag: 'mastered' },      // 1.0 -> not weak
    { kc: 'Add signed numbers', tag: 'not yet' },     // 0.15 -> weak
    { kc: 'Ratios', tag: 'above grade' },             // skipped
  ]);

  it('lowers only weak skills, to the measured value, never raising', () => {
    const changes = plan(measured, [
      { id: '1', skillTag: 'Area of a circle', pMastered: 1 },
      { id: '2', skillTag: 'Compare decimals', pMastered: 1 },
      { id: '3', skillTag: 'Add signed numbers', pMastered: 0.1 }, // already lower: untouched
      { id: '4', skillTag: 'Not on the diagnostic', pMastered: 1 },
    ]);
    expect(changes).toEqual([{ id: '1', skillTag: 'Area of a circle', from: 1, to: 0.575 }]);
    expect(measured.has('Ratios')).toBe(false);
  });
});
