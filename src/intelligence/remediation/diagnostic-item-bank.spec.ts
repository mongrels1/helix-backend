import {
  DIAGNOSTIC_ITEM_BANK,
  bankCoversKc,
  findCalibratedItemsForKc,
} from './diagnostic-item-bank';

describe('diagnostic-item-bank', () => {
  it('loads the full calibrated bank', () => {
    expect(DIAGNOSTIC_ITEM_BANK.length).toBe(89);
    for (const item of DIAGNOSTIC_ITEM_BANK) {
      expect(item.options).toHaveLength(4);
      expect(item.correct).toBeGreaterThanOrEqual(0);
      expect(item.correct).toBeLessThanOrEqual(3);
    }
  });

  it('finds calibrated items for a covered KC (case/format-insensitive)', () => {
    const exact = findCalibratedItemsForKc('Place value (whole numbers)');
    expect(exact.length).toBeGreaterThan(0);
    expect(exact[0].id).toBe('NS01');

    const fuzzy = findCalibratedItemsForKc('  place VALUE (whole numbers)  ');
    expect(fuzzy.map((i) => i.id)).toEqual(exact.map((i) => i.id));
  });

  it('returns multiple items where the bank has several for one KC', () => {
    // "Pythagorean theorem" appears more than once (G06, G13).
    const items = findCalibratedItemsForKc('Pythagorean theorem', 3);
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('respects the limit', () => {
    expect(findCalibratedItemsForKc('Pythagorean theorem', 1)).toHaveLength(1);
  });

  it('returns empty for an uncovered KC (caller falls back to AI)', () => {
    expect(findCalibratedItemsForKc('Quadratic formula derivation')).toEqual([]);
    expect(bankCoversKc('Quadratic formula derivation')).toBe(false);
    expect(bankCoversKc('Place value (whole numbers)')).toBe(true);
  });
});
