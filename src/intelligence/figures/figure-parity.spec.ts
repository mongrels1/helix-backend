// The figure language is written twice: helix-backend figure-contract.ts and
// helix-frontend figure.ts (the renderer). They drifted before (this file dropped
// coordinate-grid axis labels). Both repos check the SAME fixture, so a change to one
// parser that isn't made in the other fails CI. (17 Nov 2026)
import { readFileSync } from 'fs';
import { join } from 'path';
import { FIGURE_TYPES, parseFigure } from './figure-contract';

const FX: { types: string[]; cases: { input: unknown; expected: unknown }[] } = JSON.parse(
  readFileSync(join(__dirname, 'figure-parity.fixture.json'), 'utf8'),
);

describe('figure contract matches the frontend renderer', () => {
  it('knows exactly the figure types in the shared fixture', () => {
    expect([...FIGURE_TYPES]).toEqual(FX.types);
  });

  it(`parseFigure gives the shared result for all ${FX.cases.length} cases`, () => {
    const bad = FX.cases
      .map((c) => ({ c, got: JSON.parse(JSON.stringify(parseFigure(c.input) ?? null)) }))
      .filter(({ c, got }) => JSON.stringify(got) !== JSON.stringify(c.expected));
    expect(bad.slice(0, 5).map(({ c, got }) => ({ input: c.input, got, want: c.expected }))).toEqual([]);
  });

  it('keeps coordinate-grid axis labels and several labelled lines (Water Rates Q10)', () => {
    const f: any = parseFigure({
      type: 'coordinate_grid', xMin: 0, xMax: 40, yMin: 0, yMax: 200, xStep: 8, yStep: 40,
      xLabel: 'Water (cubic meters)', yLabel: 'Cost ($)',
      lines: [{ m: 5, b: 0, label: 'Line A' }, { m: 1.25, b: 0, label: 'Line B' }],
    });
    expect(f.xLabel).toBe('Water (cubic meters)');
    expect(f.yLabel).toBe('Cost ($)');
    expect(f.lines.map((l: any) => l.label)).toEqual(['Line A', 'Line B']);
    expect([f.xMin, f.xMax, f.yMin, f.yMax]).toEqual([0, 40, 0, 200]);
  });
});
