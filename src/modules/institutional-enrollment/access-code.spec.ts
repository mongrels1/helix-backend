import {
  addMonths, hashAccessCode, isPlausibleAccessCode, normalizeAccessCode, parseAccessCodeList,
} from './access-code';

describe('access codes', () => {
  it('normalises case, spaces and dashes to one form', () => {
    expect(normalizeAccessCode(' rdn-2ny4-97eq ')).toBe('RDN2NY497EQ');
    expect(normalizeAccessCode('RDN 2NY4 97EQ')).toBe('RDN2NY497EQ');
    expect(normalizeAccessCode(undefined)).toBe('');
  });

  it('gives one fingerprint per code however it is typed', () => {
    const h = hashAccessCode('RDN-2NY4-97EQ');
    expect(hashAccessCode('rdn 2ny4 97eq')).toBe(h);
    expect(hashAccessCode('RDN-2NY4-97EE')).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects implausible codes before any lookup', () => {
    expect(isPlausibleAccessCode('RDN-2NY4-97EQ')).toBe(true);
    expect(isPlausibleAccessCode('abc')).toBe(false);
    expect(isPlausibleAccessCode('')).toBe(false);
    expect(isPlausibleAccessCode('X'.repeat(30))).toBe(false);
  });

  it('adds calendar months like a spreadsheet EDATE', () => {
    expect(addMonths(new Date('2026-11-04T15:00:00Z'), 10).toISOString()).toBe('2027-09-04T15:00:00.000Z');
    // Clamp to month end: 31 Dec + 2 months = 28 Feb in a non-leap year.
    expect(addMonths(new Date('2026-12-31T12:00:00Z'), 2).toISOString()).toBe('2027-02-28T12:00:00.000Z');
    // 29 Feb + 12 months = 28 Feb.
    expect(addMonths(new Date('2028-02-29T00:00:00Z'), 12).toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });

  it('parses an env list in any separator, de-duplicated', () => {
    expect(parseAccessCodeList('RDN-AAAA-BBBB, rdn-aaaa-bbbb\nRDN-CCCC-DDDD;bad')).toEqual([
      'RDN-AAAA-BBBB', 'RDN-CCCC-DDDD',
    ]);
    expect(parseAccessCodeList(undefined)).toEqual([]);
  });
});
