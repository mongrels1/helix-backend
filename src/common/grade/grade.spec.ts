import { effectiveGrade, normalizeGrade } from './grade';

describe('grade helpers', () => {
  it('normalizes the ways a grade gets typed', () => {
    expect(normalizeGrade('7')).toBe('7');
    expect(normalizeGrade('Grade 7')).toBe('7');
    expect(normalizeGrade('7th')).toBe('7');
    expect(normalizeGrade('k')).toBe('K');
    expect(normalizeGrade('Kindergarten')).toBe('K');
    expect(normalizeGrade('13')).toBeNull();
    expect(normalizeGrade('')).toBeNull();
    expect(normalizeGrade(null)).toBeNull();
  });

  it("uses the student's own grade first, then the class's", () => {
    expect(effectiveGrade('6', ['7'])).toBe('6');
    expect(effectiveGrade(null, [null, '7'])).toBe('7');
    expect(effectiveGrade('', [])).toBeNull();
  });
});
