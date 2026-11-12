import { matchesName } from './find-diagnostics';

describe('find-diagnostics matchesName', () => {
  it('matches full name, first name, or a typed name containing it', () => {
    expect(matchesName('Cameron Sterling', 'Cameron Sterling')).toBe(true);
    expect(matchesName('Cameron Sterling', 'cameron')).toBe(true);
    expect(matchesName('Cameron Sterling', null, 'Cameron S')).toBe(true);
    expect(matchesName('Cameron Sterling', 'Maria Lopez', null)).toBe(false);
  });
});
