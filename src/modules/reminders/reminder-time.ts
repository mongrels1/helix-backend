/**
 * Pure, timezone/DST-correct time math for the reminder engine. Kept dependency-
 * free so it can be unit-tested in isolation and reused by the CMS phase (which
 * classifies logins as on-time/late/missed against these same occurrences).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const REMINDER_LEAD_MS = 30 * 60 * 1000; // text 30 min before the session

/** Offset (ms) of zone `tz` at the given UTC instant. Positive = ahead of UTC. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  // Intl may render midnight as "24" — normalise so Date.UTC doesn't roll a day.
  const hour = Number(p.hour) % 24;
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
    Number(p.second),
  );
  return asIfUtc - utcMs;
}

/** The UTC instant of wall-clock HH:MM on calendar date Y-M-D in zone `tz`. */
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hh: number,
  mm: number,
  tz: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hh, mm, 0);
  return new Date(guess - tzOffsetMs(guess, tz));
}

/** Weekday (0=Sun … 6=Sat) of a calendar date, independent of any timezone. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The current wall-clock calendar date in zone `tz`. */
function wallDateInTz(now: Date, tz: string): { year: number; month: number; day: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}

/** Add `n` days to a calendar date, returning a new {year,month,day}. */
function addDays(
  year: number,
  month: number,
  day: number,
  n: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The next FUTURE occurrence (UTC) of a weekly slot (dayOfWeek at studyTime in
 * tz), strictly after `now`. Scans the next 8 calendar days so it always finds
 * the upcoming one even across a week/DST boundary. Returns null if the inputs
 * are invalid (bad time, unknown tz) — the caller skips such rows.
 */
export function nextOccurrenceUtc(
  dayOfWeek: number,
  studyTime: string,
  tz: string,
  now: Date,
): Date | null {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return null;
  if (typeof studyTime !== 'string' || !TIME_RE.test(studyTime)) return null;
  let base: { year: number; month: number; day: number };
  try {
    base = wallDateInTz(now, tz);
  } catch {
    return null; // invalid timezone
  }
  const [hh, mm] = studyTime.split(':').map(Number);
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addDays(base.year, base.month, base.day, offset);
    if (weekdayOf(date.year, date.month, date.day) !== dayOfWeek) continue;
    const occ = zonedWallTimeToUtc(date.year, date.month, date.day, hh, mm, tz);
    if (occ.getTime() > now.getTime()) return occ;
  }
  return null;
}

/**
 * True when we're inside the send window: at or past the "lead" mark before the
 * session, but not yet at the session start. Self-healing — a cron run that was
 * delayed still fires (a little late) rather than skipping the session entirely;
 * the StudyReminder unique key prevents any double-send.
 */
export function isDue(occurrenceUtc: Date, now: Date, leadMs = REMINDER_LEAD_MS): boolean {
  const delta = occurrenceUtc.getTime() - now.getTime();
  return delta > 0 && delta <= leadMs;
}
