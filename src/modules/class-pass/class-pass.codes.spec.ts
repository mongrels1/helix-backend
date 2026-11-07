import {
  CLASS_PASS_ALPHABET,
  displayName,
  endOfSchoolDayMs,
  hashBackup,
  hashBadge,
  isPlausibleBadge,
  newBackupCode,
  newBadgeSecret,
  newClassCode,
  normalizeCode,
  parseStudentName,
  sameHash,
  startOfSchoolDay,
} from './class-pass.codes';

describe('class-pass codes', () => {
  it('uses an alphabet with no look-alike characters', () => {
    for (const c of '01OIL') expect(CLASS_PASS_ALPHABET).not.toContain(c);
  });

  it('makes badge secrets of 26 characters that are all different', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const s = newBadgeSecret();
      expect(s).toMatch(new RegExp(`^[${CLASS_PASS_ALPHABET}]{26}$`));
      seen.add(s);
    }
    expect(seen.size).toBe(2000);
    // 26 symbols from 31 letters is about 129 bits
    expect(26 * Math.log2(CLASS_PASS_ALPHABET.length)).toBeGreaterThan(128);
  });

  it('prints backup codes as XXX-XXX and class codes as 6 characters', () => {
    expect(newBackupCode()).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(newClassCode()).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('accepts a badge or code typed loosely', () => {
    const s = newBadgeSecret();
    expect(hashBadge(s.toLowerCase())).toBe(hashBadge(s));
    expect(hashBackup('stu', 'abc def')).toBe(hashBackup('stu', 'ABC-DEF'));
    expect(normalizeCode(' ab-c d ')).toBe('ABCD');
  });

  it('salts backup hashes by student, and keeps badge and backup hashes apart', () => {
    expect(hashBackup('a', 'ABCDEF')).not.toBe(hashBackup('b', 'ABCDEF'));
    expect(hashBadge('ABCDEF')).not.toBe(hashBackup('a', 'ABCDEF'));
  });

  it('compares hashes safely', () => {
    expect(sameHash(hashBadge('X'.repeat(26)), hashBadge('x'.repeat(26)))).toBe(true);
    expect(sameHash(hashBadge('X'.repeat(26)), hashBadge('Y'.repeat(26)))).toBe(false);
    expect(sameHash('ab', 'abcd')).toBe(false);
  });

  it('rejects implausible badges before any lookup', () => {
    expect(isPlausibleBadge('')).toBe(false);
    expect(isPlausibleBadge('SHORT')).toBe(false);
    expect(isPlausibleBadge(newBadgeSecret())).toBe(true);
  });

  it('reads names from a pasted list in either order', () => {
    expect(parseStudentName('Maria Lopez')).toEqual({ firstName: 'Maria', lastName: 'Lopez' });
    expect(parseStudentName('  Lopez,  Maria ')).toEqual({ firstName: 'Maria', lastName: 'Lopez' });
    expect(parseStudentName('Ana de la Cruz')).toEqual({ firstName: 'Ana', lastName: 'de la Cruz' });
    expect(parseStudentName('Prince')).toEqual({ firstName: 'Prince', lastName: '' });
    expect(parseStudentName('   ')).toBeNull();
    expect(parseStudentName(', Maria')).toBeNull();
  });

  it('shows first name and last initial only', () => {
    expect(displayName('Maria', 'lopez')).toBe('Maria L.');
    expect(displayName('Prince', '')).toBe('Prince');
    expect(displayName(null, null)).toBe('Student');
  });

  it('ends a badge session at 6 a.m. school time, never under 2 hours', () => {
    // 10:00 ET (15:00Z, EST) -> 20 h to 06:00
    expect(endOfSchoolDayMs(new Date('2026-11-09T15:00:00Z'))).toBe(20 * 3600_000);
    // 05:30 ET -> 30 min away, so the 2 h floor applies
    expect(endOfSchoolDayMs(new Date('2026-11-09T10:30:00Z'))).toBe(2 * 3600_000);
    // 21:00 ET -> 9 h
    expect(endOfSchoolDayMs(new Date('2026-11-10T02:00:00Z'))).toBe(9 * 3600_000);
  });

  it('starts the help day at midnight school time', () => {
    expect(startOfSchoolDay(new Date('2026-11-09T15:00:00Z')).toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(startOfSchoolDay(new Date('2026-11-10T03:00:00Z')).toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });
});
