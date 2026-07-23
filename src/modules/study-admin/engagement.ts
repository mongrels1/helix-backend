import {
  addDays,
  wallDateInTz,
  weekdayOf,
  zonedWallTimeToUtc,
} from '../reminders/reminder-time';

/**
 * Pure engagement analytics: turn a student's weekly plan + their login history
 * into scored session occurrences (on-time / late / missed), a consistency
 * streak, and an adherence rate. Timezone/DST-correct via the shared reminder
 * time math. No I/O — unit-testable and reused by the study-admin service.
 */

export type OccurrenceStatus = 'on-time' | 'late' | 'missed' | 'upcoming';

export interface ScheduleRow {
  scheduleId: string;
  dayOfWeek: number; // 0=Sun … 6=Sat
  studyTime: string; // "HH:MM"
}

export interface ScoredOccurrence {
  scheduleId: string;
  dayOfWeek: number;
  studyTime: string;
  scheduledFor: Date; // UTC instant of the session start
  status: OccurrenceStatus;
}

// A login "counts" for a session if it lands from 15 min before to 60 min after
// the start (on-time); anything later the same 24h is "late"; nothing within 24h
// is "missed".
export const ON_TIME_BEFORE_MS = 15 * 60 * 1000;
export const ON_TIME_AFTER_MS = 60 * 60 * 1000;
export const LATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** All scheduled occurrences (UTC) in [from, to] for the given weekly rows. */
export function enumerateOccurrences(
  schedules: ScheduleRow[],
  tz: string | null,
  from: Date,
  to: Date,
): Array<Omit<ScoredOccurrence, 'status'>> {
  if (!tz || schedules.length === 0 || from.getTime() > to.getTime()) return [];
  let base: { year: number; month: number; day: number };
  try {
    base = wallDateInTz(from, tz);
  } catch {
    return []; // invalid timezone
  }
  const spanDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const out: Array<Omit<ScoredOccurrence, 'status'>> = [];
  for (let offset = 0; offset <= spanDays; offset += 1) {
    const d = addDays(base.year, base.month, base.day, offset);
    const dow = weekdayOf(d.year, d.month, d.day);
    for (const s of schedules) {
      if (s.dayOfWeek !== dow) continue;
      const [hh, mm] = s.studyTime.split(':').map(Number);
      const occ = zonedWallTimeToUtc(d.year, d.month, d.day, hh, mm, tz);
      if (occ.getTime() >= from.getTime() && occ.getTime() <= to.getTime()) {
        out.push({ scheduleId: s.scheduleId, dayOfWeek: s.dayOfWeek, studyTime: s.studyTime, scheduledFor: occ });
      }
    }
  }
  out.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  return out;
}

/**
 * Classify one occurrence against the student's login timestamps. Monotonic:
 * on-time if a login lands around the session; late if within 24h; otherwise
 * "upcoming" until the 24h window fully elapses, then "missed".
 */
export function classifyOccurrence(occurrence: Date, loginMs: number[], now: Date): OccurrenceStatus {
  const t = occurrence.getTime();
  if (loginMs.some((l) => l >= t - ON_TIME_BEFORE_MS && l <= t + ON_TIME_AFTER_MS)) return 'on-time';
  if (loginMs.some((l) => l > t + ON_TIME_AFTER_MS && l <= t + LATE_WINDOW_MS)) return 'late';
  if (now.getTime() < t + LATE_WINDOW_MS) return 'upcoming'; // still within the 24h grace
  return 'missed';
}

export function scoreOccurrences(
  occurrences: Array<Omit<ScoredOccurrence, 'status'>>,
  loginMs: number[],
  now: Date,
): ScoredOccurrence[] {
  return occurrences.map((o) => ({
    ...o,
    status: classifyOccurrence(o.scheduledFor, loginMs, now),
  }));
}

export interface EngagementSummary {
  onTime: number;
  late: number;
  missed: number;
  upcoming: number;
  scored: number; // on-time + late + missed
  attended: number; // on-time + late
  adherencePct: number | null; // attended / scored, null when nothing scored yet
  streak: number; // consecutive attended sessions, most recent backwards
}

/** Roll scored occurrences up into counts, adherence, and the current streak.
 *  Streak = consecutive attended (on-time OR late) sessions counting back from
 *  the most recent SCORED one; a missed session breaks it; upcoming ones are
 *  ignored (not yet due). Expects `scored` sorted ascending by scheduledFor. */
export function summarize(scored: ScoredOccurrence[]): EngagementSummary {
  let onTime = 0, late = 0, missed = 0, upcoming = 0;
  for (const o of scored) {
    if (o.status === 'on-time') onTime += 1;
    else if (o.status === 'late') late += 1;
    else if (o.status === 'missed') missed += 1;
    else upcoming += 1;
  }
  const scoredCount = onTime + late + missed;
  const attended = onTime + late;

  let streak = 0;
  for (let i = scored.length - 1; i >= 0; i -= 1) {
    const s = scored[i].status;
    if (s === 'upcoming') continue; // not yet due — skip
    if (s === 'missed') break;
    streak += 1; // on-time or late
  }

  return {
    onTime,
    late,
    missed,
    upcoming,
    scored: scoredCount,
    attended,
    adherencePct: scoredCount > 0 ? Math.round((attended / scoredCount) * 100) : null,
    streak,
  };
}
