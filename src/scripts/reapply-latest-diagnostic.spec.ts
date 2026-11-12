import { measuredByKc, plan } from './reapply-latest-diagnostic';

describe('reapply-latest-diagnostic', () => {
  const measured = measuredByKc([
    { kc: 'Area of a circle', tag: 'emerging' },      // missed a harder question -> weak (0.4)
    { kc: 'Compare decimals', tag: 'mastered' },      // 1.0 -> not weak
    { kc: 'Add signed numbers', tag: 'notyet' },      // 0.15 -> weak
    { kc: 'Volume', tag: 'emerging' },                // weak, no score yet -> created
    { kc: 'Ratios', tag: 'stretch' },                 // not scored
  ]);

  it('lowers weak skills to the measured value, creates missing ones, never raises', () => {
    const changes = plan(measured, [
      { id: '1', skillTag: 'Area of a circle', pMastered: 1 },
      { id: '2', skillTag: 'Compare decimals', pMastered: 1 },
      { id: '3', skillTag: 'Add signed numbers', pMastered: 0.1 }, // already lower: untouched
      { id: '4', skillTag: 'Not on the diagnostic', pMastered: 1 },
    ]);
    expect(changes).toEqual([
      { id: '1', skillTag: 'Area of a circle', from: 1, to: 0.4 },
      { id: null, skillTag: 'Volume', from: null, to: 0.4 },
    ]);
    expect(measured.has('Ratios')).toBe(false);
  });
});
