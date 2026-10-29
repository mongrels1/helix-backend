import { createHash } from 'crypto';

/**
 * Per-student enrollment access codes — the pure rules, no I/O.
 *
 * A code is printed on one flyer for one student (format RDN-XXXX-XXXX, from an
 * alphabet with no 0/O, 1/I/L). Families type it, scan it, or a teacher reads it
 * out, so everything here is forgiving about case, spaces and dashes while still
 * producing exactly one fingerprint per code.
 */

/** Upper-case, strip everything that is not a letter or digit. */
export function normalizeAccessCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The only form of a code the database ever holds. SHA-256 of the normalised
 * code: the codes themselves never leave the flyers and the spreadsheet.
 */
export function hashAccessCode(raw: string): string {
  return createHash('sha256').update(normalizeAccessCode(raw)).digest('hex');
}

/** A plausible code is 6–24 letters/digits once normalised. Anything else is rejected before a lookup. */
export function isPlausibleAccessCode(raw: string | null | undefined): boolean {
  const n = normalizeAccessCode(raw);
  return n.length >= 6 && n.length <= 24;
}

/**
 * `from` plus `months` calendar months, clamped to the last day of the target
 * month (31 Jan + 1 month = 28/29 Feb), the same rule as a spreadsheet's EDATE —
 * so the date on the teacher's sheet and the date the app enforces agree.
 */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Parse the ACCESS_CODES_<SLUG> env value: codes separated by commas, spaces or newlines. */
export function parseAccessCodeList(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (value ?? '').split(/[\s,;]+/)) {
    if (!isPlausibleAccessCode(part)) continue;
    const n = normalizeAccessCode(part);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(part.trim());
  }
  return out;
}
