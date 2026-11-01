/**
 * Day status and dates for the weekly lesson plan (Track LP1: R1 + R9).
 *
 * Why this exists: a teacher's template lists every weekday, and the generator
 * used to write a full classroom lesson for each one — including a day the
 * school was closed or had marked as an Independent Learning Day (seen on the
 * Redan Grade 7 plan for 3 Nov 2026). It also never knew any day's date, so it
 * could not connect "Nov 3 ILD" in a pacing guide to "Tuesday".
 *
 * Every day now carries a status and, when the teacher gives the first day of
 * the week, a date. Non-teaching days keep their position (the sidecar fill is
 * positional), and a no-school day costs no AI call at all.
 */

export const DAY_STATUSES = ['teach', 'ild', 'no_school', 'test', 'centers', 'half_day'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export interface DayPlanEntry {
  name?: string;
  status?: DayStatus;
  reason?: string;
}

export interface ResolvedDay {
  name: string;
  status: DayStatus;
  reason?: string;
  /** ISO yyyy-mm-dd, when a week start was given. */
  date?: string;
  /** e.g. "Tuesday, 3 Nov 2026" — what the model and the teacher see. */
  dateLabel?: string;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Monday = 0 … Sunday = 6, from "Monday", "Mon", "TUE", "Day 3 (Wed)"; else null. */
export function weekdayIndex(name: string): number | null {
  const n = (name ?? '').toLowerCase();
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i].slice(0, 3)}`).test(n)) return i;
  }
  return null;
}

/** Parse yyyy-mm-dd as a calendar date (UTC, so no timezone drift). */
export function parseIsoDate(iso?: string): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function labelOf(d: Date): string {
  const wd = WEEKDAYS[(d.getUTCDay() + 6) % 7];
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The date of each template day. A day named for a weekday gets that weekday
 * in the week that starts on `weekStart`; a day with no weekday in its name
 * ("Day 1") is counted from the start date by position.
 */
export function datesFor(days: string[], weekStart?: string): (Date | null)[] {
  const start = parseIsoDate(weekStart);
  if (!start) return days.map(() => null);
  const startIdx = (start.getUTCDay() + 6) % 7; // Monday = 0
  return days.map((name, pos) => {
    const wd = weekdayIndex(name);
    const offset = wd === null ? pos : (wd - startIdx + 7) % 7;
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + offset);
    return d;
  });
}

/**
 * Merge the template's day list with the teacher's choices. Entries match by
 * name first, then by position. Anything unknown is a teaching day, so an old
 * client that sends only `days: string[]` gets exactly the old behaviour.
 */
export function resolveDays(days: string[], dayPlan?: DayPlanEntry[], weekStart?: string): ResolvedDay[] {
  const dates = datesFor(days, weekStart);
  const plan = dayPlan ?? [];
  return days.map((name, i) => {
    const byName = plan.find((p) => p?.name && p.name.trim().toLowerCase() === name.trim().toLowerCase());
    const entry = byName ?? (plan[i] && !plan[i].name ? plan[i] : undefined) ?? {};
    const status: DayStatus = DAY_STATUSES.includes(entry.status as DayStatus)
      ? (entry.status as DayStatus)
      : 'teach';
    const d = dates[i];
    return {
      name,
      status,
      reason: entry.reason?.trim() || undefined,
      date: d ? isoOf(d) : undefined,
      dateLabel: d ? labelOf(d) : undefined,
    };
  });
}

/** "Nov 2–6, 2026", "Oct 30 – Nov 3, 2026" or "Dec 29, 2026 – Jan 2, 2027", for the header. */
export function formatWeekRange(resolved: ResolvedDay[]): string | undefined {
  const ds = resolved.map((r) => parseIsoDate(r.date)).filter((d): d is Date => !!d);
  if (!ds.length) return undefined;
  const a = new Date(Math.min(...ds.map((d) => d.getTime())));
  const b = new Date(Math.max(...ds.map((d) => d.getTime())));
  const m = (d: Date) => MONTHS[d.getUTCMonth()];
  if (a.getTime() === b.getTime()) return `${m(a)} ${a.getUTCDate()}, ${a.getUTCFullYear()}`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    return `${m(a)} ${a.getUTCDate()}, ${a.getUTCFullYear()} – ${m(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  if (a.getUTCMonth() !== b.getUTCMonth()) {
    return `${m(a)} ${a.getUTCDate()} – ${m(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  }
  return `${m(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}

const STATUS_WORDS: Record<DayStatus, string> = {
  teach: 'teaching day',
  ild: 'independent learning day (no class session)',
  no_school: 'no school',
  test: 'assessment day',
  centers: 'centers / stations day',
  half_day: 'half day (shortened period)',
};

/** One line per day, so every parallel day call knows the shape of the week. */
export function weekOverview(resolved: ResolvedDay[]): string {
  return resolved
    .map((r) => {
      const when = r.dateLabel ?? r.name;
      const why = r.reason ? ` (${r.reason})` : '';
      return `${when}: ${STATUS_WORDS[r.status]}${why}`;
    })
    .join('; ');
}

/** The extra instruction a non-standard teaching day adds to its prompt. */
export function statusNote(r: ResolvedDay): string | undefined {
  const why = r.reason ? ` Teacher's note: ${r.reason}.` : '';
  switch (r.status) {
    case 'test':
      return `This is an ASSESSMENT day: a short review, then the assessment, then reflection. No new content.${why}`;
    case 'centers':
      return `This is a CENTERS / STATIONS day: describe each rotation, what it is for and the materials at each station.${why}`;
    case 'half_day':
      return `This is a HALF DAY: the period is shortened. Keep only the essential moves.${why}`;
    default:
      return why ? why.trim() : undefined;
  }
}

/* ------------------------------------------------------------------------- */
/*  Non-teaching days                                                         */
/* ------------------------------------------------------------------------- */

const NO_CLASS = 'Independent learning day – no class session.';

function blankSegments(segmentsPerDay: number, teacherText: string) {
  return Array.from({ length: Math.max(1, segmentsPerDay) }, () => ({
    lesson_component: '',
    teacher_actions: teacherText,
    student_actions: '',
    academic_vocabulary: '',
    writing_strategies: '',
    assessment_strategies: '',
    differentiation: {},
  }));
}

/** A no-school day: written in code, no AI call, keeps its column. */
export function noSchoolDay(r: ResolvedDay, segmentsPerDay: number) {
  const text = `No school${r.reason ? ` – ${r.reason}` : ''}.`;
  return {
    name: r.name,
    status: 'no_school' as const,
    standard: text,
    wida: '',
    // Left blank: templates print "Today, we are learning to:" before it.
    learning_target: '',
    success_criteria: '',
    instructional_resources: '',
    segments: blankSegments(segmentsPerDay, text),
  };
}

/** A generation that failed for one day: keep the column, say so plainly. */
export function failedDay(r: ResolvedDay, segmentsPerDay: number) {
  const text = 'This day could not be generated. Generate the plan again, or write this day by hand.';
  return {
    name: r.name,
    status: 'failed' as const,
    standard: text,
    wida: '',
    learning_target: '',
    success_criteria: '',
    instructional_resources: '',
    segments: blankSegments(segmentsPerDay, text),
  };
}

export interface IldDraft {
  standard?: string;
  wida?: string;
  learning_target?: string;
  success_criteria?: string;
  instructional_resources?: string;
  student_directions?: string;
  assignment?: string;
  answer_key?: string;
}

/** Shape an ILD draft into the template's day structure. */
export function ildDay(r: ResolvedDay, draft: IldDraft, segmentsPerDay: number) {
  const segs = blankSegments(segmentsPerDay, NO_CLASS);
  segs[0].student_actions = [draft.student_directions, draft.assignment && `Assignment: ${draft.assignment}`]
    .filter(Boolean)
    .join('\n');
  segs[0].assessment_strategies = draft.answer_key ? `Answer key: ${draft.answer_key}` : '';
  return {
    name: r.name,
    status: 'ild' as const,
    standard: draft.standard ?? '',
    wida: draft.wida ?? '',
    learning_target: draft.learning_target ?? '',
    success_criteria: draft.success_criteria ?? '',
    instructional_resources: draft.instructional_resources ?? '',
    segments: segs,
  };
}

/* ------------------------------------------------------------------------- */
/*  Suggestions from the pacing guide (R9): a regex, no AI                   */
/* ------------------------------------------------------------------------- */

export interface DaySuggestion {
  name: string;
  date: string;
  status: Extract<DayStatus, 'ild' | 'no_school'>;
  evidence: string;
}

const ILD_RE = /\b(ILD|independent\s+learning|asynchronous|virtual\s+learning\s+day|digital\s+learning\s+day|e-?learning\s+day)\b/i;
const CLOSED_RE =
  /\b(no\s+school|school\s+closed|closed|holiday|break|teacher\s+work\s*day|teacher\s+planning\s+day|staff\s+development|professional\s+(?:learning|development)\s+day|student\s+holiday|election\s+day)\b/i;

function datePatterns(d: Date): RegExp[] {
  const day = d.getUTCDate();
  const mon = d.getUTCMonth();
  const mm = mon + 1;
  const dd = `0?${day}`;
  const short = MONTHS[mon];
  const long = MONTHS_LONG[mon];
  return [
    new RegExp(`\\b(?:${long}|${short})\\.?\\s+${dd}(?!\\d)`, 'i'),       // November 3 / Nov. 3
    new RegExp(`\\b${dd}[\\s-]+(?:${long}|${short})\\b`, 'i'),            // 3 Nov / 3-Nov
    new RegExp(`(?<![\\d/])0?${mm}/${dd}(?![\\d])(?:/\\d{2,4})?`),        // 11/3, 11/03/26
  ];
}

/**
 * Days the teacher's own resources mark as an ILD or a closure, for the
 * teacher to confirm. Looks only at the line that names the date: reading the
 * next line as well flagged ordinary days whose neighbour was an ILD.
 * An ILD mention wins over a closure word on the same line.
 */
export function suggestDayStatuses(
  days: string[],
  weekStart: string | undefined,
  resourcesText: string,
): DaySuggestion[] {
  const resolved = resolveDays(days, undefined, weekStart);
  const lines = (resourcesText ?? '').split(/\r?\n/);
  const out: DaySuggestion[] = [];
  for (const r of resolved) {
    const d = parseIsoDate(r.date);
    if (!d) continue;
    const pats = datePatterns(d);
    for (let i = 0; i < lines.length; i++) {
      if (!pats.some((p) => p.test(lines[i]))) continue;
      const window = lines[i];
      const status = ILD_RE.test(window) ? 'ild' : CLOSED_RE.test(window) ? 'no_school' : null;
      if (!status) continue;
      out.push({
        name: r.name,
        date: r.date as string,
        status,
        evidence: lines[i].replace(/\s+/g, ' ').trim().slice(0, 140),
      });
      break;
    }
  }
  return out;
}
