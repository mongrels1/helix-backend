import { createHash, randomInt, timingSafeEqual } from 'crypto';

/**
 * Class Pass codes: the pure rules, no I/O.
 *
 * - Badge secret: what the printed QR carries (`/go/<secret>`). 26 characters
 *   from a 31-letter alphabet, about 129 bits: it cannot be guessed, so the
 *   card itself is the credential.
 * - Backup code: 6 characters printed under the QR, typed only together with
 *   the class code and the student's name, and locked after 5 misses.
 * - Class code: 6 characters the teacher writes on the board. It only finds
 *   the class; it is not a credential on its own.
 *
 * The alphabet has no 0/O, 1/I/L, so a code read off a card is never ambiguous.
 * Only SHA-256 hashes of the badge secret and backup code are stored (the Redan
 * access-code pattern).
 */
export const CLASS_PASS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CLASS_PASS_ALPHABET[randomInt(CLASS_PASS_ALPHABET.length)];
  }
  return out;
}

/** Upper-case and strip everything that is not a letter or digit. */
export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function newBadgeSecret(): string {
  return randomCode(26);
}

/** Printed as XXX-XXX; stored and compared without the dash. */
export function newBackupCode(): string {
  const c = randomCode(6);
  return `${c.slice(0, 3)}-${c.slice(3)}`;
}

/**
 * The personal code a student types at /class: 8 characters, printed XXXX-XXXX.
 * ~40 bits, unique across the platform, so on its own it opens one account,
 * like a bank card PIN plus card in one, without any name list.
 */
export function newPersonalCode(): string {
  const c = randomCode(8);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export function hashPersonal(code: string): string {
  return createHash('sha256').update(`code:${normalizeCode(code)}`).digest('hex');
}

export function newClassCode(): string {
  return randomCode(6);
}

export function hashBadge(secret: string): string {
  return createHash('sha256').update(`badge:${normalizeCode(secret)}`).digest('hex');
}

/**
 * Salted with the student id, so two students who happen to get the same backup
 * code have different hashes, and a hash from one row says nothing about another.
 */
export function hashBackup(studentId: string, code: string): string {
  return createHash('sha256').update(`backup:${studentId}:${normalizeCode(code)}`).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isPlausibleBadge(raw: string | null | undefined): boolean {
  const n = normalizeCode(raw);
  return n.length >= 20 && n.length <= 40;
}

/**
 * "Maria Lopez", "Lopez, Maria", "Maria  de la Cruz" → first / last.
 * Accepts one name per line from a pasted list or a spreadsheet column.
 */
export function parseStudentName(raw: string): { firstName: string; lastName: string } | null {
  const line = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  if (line.includes(',')) {
    const [last, ...rest] = line.split(',');
    const first = rest.join(' ').trim();
    if (!first || !last.trim()) return null;
    return { firstName: first, lastName: last.trim() };
  }
  const parts = line.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** What the class list and the badge show: "Maria L." Never the full surname. */
export function displayName(firstName?: string | null, lastName?: string | null): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  return l ? `${f} ${l[0].toUpperCase()}.` : f || 'Student';
}

/**
 * When a badge session should end: 6 a.m. tomorrow in the school's time zone
 * (America/New_York), and at least 2 hours from now. So a Chromebook left signed
 * in overnight is signed out by the next morning, and an evening study session
 * started at home still lasts the evening.
 */
export function endOfSchoolDayMs(now = new Date(), timeZone = 'America/New_York'): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutesNow = h * 60 + m;
  const target = 6 * 60; // 06:00 local
  let minutesLeft = target - minutesNow;
  if (minutesLeft <= 0) minutesLeft += 24 * 60;
  return Math.max(minutesLeft, 120) * 60 * 1000;
}

/** Start of "today" in the school's time zone, as a UTC instant (for the daily help cap). */
export function startOfSchoolDay(now = new Date(), timeZone = 'America/New_York'): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsedMs = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}
