import { addDays, wallDateInTz, weekdayOf, zonedWallTimeToUtc } from '../reminders/reminder-time';

/**
 * The school week every report uses: Monday 00:00 to the next Monday 00:00,
 * school time (America/New_York). Teacher pages, printouts and the Sunday
 * parent email all read the same week, so their numbers match.
 * Pure: no I/O.
 */
export const SCHOOL_TZ = 'America/New_York';

export interface SchoolWeek {
  /** Monday, YYYY-MM-DD (school-local). */
  start: string;
  /** Sunday, YYYY-MM-DD (school-local). */
  end: string;
  /** The 7 school-local dates, Monday first. */
  days: string[];
  /** Monday 00:00 school time, as an instant. */
  startUtc: Date;
  /** Next Monday 00:00 school time, as an instant (exclusive). */
  endUtc: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: { year: number; month: number; day: number }) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

/** `week` may be any date in the wanted week (YYYY-MM-DD); omitted/invalid = this week. */
export function schoolWeek(week?: string | null, now = new Date(), tz = SCHOOL_TZ): SchoolWeek {
  let base = wallDateInTz(now, tz);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week ?? '');
  if (m) {
    const cand = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    const check = new Date(Date.UTC(cand.year, cand.month - 1, cand.day));
    if (check.getUTCFullYear() === cand.year && check.getUTCMonth() === cand.month - 1 && check.getUTCDate() === cand.day) {
      base = cand;
    }
  }
  const back = (weekdayOf(base.year, base.month, base.day) + 6) % 7; // Monday = 0
  const mon = addDays(base.year, base.month, base.day, -back);
  const nextMon = addDays(mon.year, mon.month, mon.day, 7);
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(mon.year, mon.month, mon.day, i)));
  return {
    start: days[0],
    end: days[6],
    days,
    startUtc: zonedWallTimeToUtc(mon.year, mon.month, mon.day, 0, 0, tz),
    endUtc: zonedWallTimeToUtc(nextMon.year, nextMon.month, nextMon.day, 0, 0, tz),
  };
}

export const DEFAULT_GOAL_MINUTES = 180;

/** Green / amber / red / grey band used on every screen and printout. */
export type PracticeBand = 'met' | 'partway' | 'low' | 'none';
export function practiceBand(minutes: number, goal: number, signedIn: boolean): PracticeBand {
  if (!signedIn && minutes === 0) return 'none';
  if (minutes >= goal) return 'met';
  if (minutes >= 60) return 'partway';
  return 'low';
}
