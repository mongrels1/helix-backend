/**
 * Prompt construction for math weekly lesson-plan generation.
 * The model returns CONTENT only (no minute counts); pacing is applied
 * deterministically by the sidecar. Mirrors the reference Python generator.
 */

export const DIFF_GROUPS = ['ESOL', 'Gifted', 'SWD'] as const;

/** Resources beyond this many characters are cut (R7 reports which files). */
/**
 * How much of the teacher's uploads each day sees. Raised from 12,000 on
 * 1 Nov 2026 (John): the plans must be built from the teacher's (abundant)
 * resources, and 12,000 characters cut every 2a/2b PDF short. About 11k
 * tokens; at this size the shared block clears the cache minimum, so the
 * other days read it at a tenth of the price.
 */
export const RESOURCE_CHAR_LIMIT = 40000;

/**
 * Track LP2 (R6): no district is named here. The phases are the Lesson
 * Component options the template itself offers; a teacher who works to a
 * named framework says so in their notes, and the resources carry the rest.
 * (This used to name the DCSD framework for every teacher in every district.)
 */
export const LESSON_PLAN_SYSTEM =
  'You are an expert K-12 mathematics instructional coach writing a weekly ' +
  "lesson plan into a teacher's own school template. Lesson phases are the " +
  "template's Lesson Component options: Pre-Instructional, Engage, Explore, " +
  'Apply, Reflect. If the teacher names an instructional framework in their ' +
  'notes or resources, follow it. You write concrete, classroom-ready teacher ' +
  'moves and student moves, grounded ONLY in the provided resources (pacing ' +
  'guide, ILP, performance tasks, standards, roster data). Be specific to the ' +
  'math standards given. You never invent standards not supported by the ' +
  'resources. Output MUST be valid JSON matching the requested schema and ' +
  'nothing else.';

export interface PlanConfig {
  period_minutes: number;
  grade?: string;
  unit?: string;
  week?: string;
  teacher?: string;
  co_teaching?: string;
  days: string[];
  segments_per_day: number;
  differentiation_groups: string[];
  strategies?: string[];
  /** Free-text teacher notes: what to add, emphasize, or differentiate. */
  instructions?: string;
}

/**
 * Where this one day sits in the week. Every day is drafted in its own
 * parallel call, so without this a day cannot know its date, that yesterday
 * was an Independent Learning Day, or that tomorrow is a test (LP1), nor what
 * job it does in the week's arc (LP4).
 */
export interface DayContext {
  /** e.g. "Tuesday, 3 Nov 2026". */
  dateLabel?: string;
  /** One line per day of the week: date, status, teacher's reason. */
  weekOverview?: string;
  /** Extra instruction for a test, centers or half day. */
  statusNote?: string;
  /** 1-based position among the week's class days, and how many there are. */
  position?: { k: number; n: number };
  /** This day's job in the arc, e.g. "introduce", "build", "review before Friday's assessment". */
  role?: string;
  /** What the day before and the day after are (status, and the teacher's note). */
  before?: string;
  after?: string;
  /**
   * The Small Group section is one per WEEK, so only the first class day
   * writes it. Every day used to write it and all but one copy was thrown
   * away, which made each reply longer and more likely to break.
   */
  includeSmallGroup?: boolean;
}

/**
 * The part of every day's prompt that is identical across the week: class
 * context, the teacher's notes and the resources. Sent first so it can be
 * cached once and read by every other day call (LP3, R5).
 */
export function buildSharedContext(config: PlanConfig, resourcesText: string): string {
  const groups = config.differentiation_groups ?? [...DIFF_GROUPS];
  return [
    'CLASS CONTEXT (the same for every day of this week):',
    `- Grade/Course: ${config.grade ?? ''}`,
    `- Unit: ${config.unit ?? ''}`,
    ...(config.week ? [`- Week of: ${config.week}`] : []),
    `- Period length: ${config.period_minutes} minutes`,
    `- Segments per class day: ${config.segments_per_day}`,
    `- Co-teaching/para: ${config.co_teaching ?? 'None'} (if not None, split teacher_actions by role: 'Teacher 1: ... Teacher 2: ...')`,
    `- Differentiation groups in this class: ${JSON.stringify(groups)}`,
    `- Strategies to weave in where appropriate (not forced): ${JSON.stringify(config.strategies ?? [])}`,
    ...(config.instructions && config.instructions.trim()
      ? [
          '',
          "TEACHER'S SPECIFIC INSTRUCTIONS (high priority — honor these wherever they apply, without breaking the required structure or inventing standards not in the resources):",
          config.instructions.trim(),
        ]
      : []),
    '',
    'RESOURCES (plan strictly from these):',
    resourcesText.slice(0, RESOURCE_CHAR_LIMIT),
  ].join('\n');
}

const GENERIC =
  "'support struggling learners', 'provide scaffolds', 'challenge advanced students', 'offer extension activities', 'use visuals'";

/** The day-specific part of a class day's prompt (sent after the shared context). */
export function buildLessonDayPrompt(config: PlanConfig, day?: DayContext): string {
  const groups = config.differentiation_groups ?? [...DIFF_GROUPS];
  const diffSchema = groups
    .map((g) => `"${g}": "${g === 'Gifted' ? 'Stretch' : 'Support'}: one named move tied to this segment's task"`)
    .join(', ');

  const schema = `{
 "days": [{
   "name": "the day name",
   "standard": "the specific standard code + short description for that day",
   "wida": "WIDA ELD standard + brief content/language objective",
   "learning_target": "what students learn today, written to follow the template's own words 'Today, we are learning to:' (do not repeat that phrase)",
   "success_criteria": "'I can...' observable evidence",
   "instructional_resources": "specific texts/materials/tasks used that day",
   "where_this_fits": "ONE line: how today builds on the day before and sets up the day after",
   "academic_vocabulary": "key terms for the whole day",
   "writing_strategies": "the day's writing-to-learn move",
   "watch_for": ["one sentence naming a misconception students commonly have with today's skill"],
   "worked_example": {"source": "the resource it comes from (file name / task)", "problem": "a problem taken from the resources (same context; numbers may change)", "solution": "the full solution, step by step"},
   "practice": [{"source": "the resource it comes from", "problem": "a problem taken from the resources", "answer": "..."}],
   "segments": [{
     "lesson_component": "one of: Pre-Instructional, Engage, Explore, Apply, Reflect",
     "teacher_actions": "concrete teacher moves for this phase",
     "student_actions": "what students do this phase",
     "assessment_strategies": "how understanding is checked this phase",
     "differentiation": { ${diffSchema} }
   }]
 }]${
   day?.includeSmallGroup === false
     ? ''
     : `,
 "small_group": [{
   "rationale": "data point driving this group", "identifier": "e.g. Tier 2",
   "skill": "target skill", "strategy": "approach", "activity": "the task"
 }]`
 }
}`;

  const pos = day?.position;
  return [
    'Write ONE class day of a weekly math lesson plan, using the class context and resources above.',
    '',
    'THIS DAY:',
    `- Day (produce exactly this one): ${JSON.stringify(config.days)}`,
    ...(day?.dateLabel ? [`- Date: ${day.dateLabel}`] : []),
    ...(pos ? [`- Class day ${pos.k} of ${pos.n} this week.`] : []),
    ...(day?.role ? [`- Its job in the week: ${day.role}.`] : []),
    ...(day?.before ? [`- The day before: ${day.before}`] : []),
    ...(day?.after ? [`- The day after: ${day.after}`] : []),
    ...(day?.weekOverview
      ? [
          `- The whole week (for context only; plan just this day): ${day.weekOverview}`,
          '- Never describe a no-school or independent-learning day as a class session. If the day before was independent learning, open by reviewing that assignment and use it to group students.',
        ]
      : []),
    ...(day?.statusNote ? [`- ${day.statusNote}`] : []),
    '',
    'RULES:',
    `- EXACTLY ${config.segments_per_day} segments, in a sensible phase order for this day's job.`,
    '- Do not include minute counts; pacing is computed separately.',
    '- Ground every standard/target in the resources.',
    ...(day?.includeSmallGroup === false ? ['- Do not write a small_group section (another day writes it).'] : []),
    '- Output strictly valid JSON: escape any double quote inside a string as \\" (or use single quotes), no line breaks inside strings, no trailing commas.',
    "- USE THE TEACHER'S RESOURCES, not outside content. Every task, context, example and problem comes from the uploaded resources (their tasks, reproducibles, diagnostics, data talks, HMH practice). Do not introduce outside contexts (notebooks, widgets, gyms, cookies…) or real-world figures that are not in the resources.",
    '- worked_example and practice: take them from the resources and name the source. You may change the numbers to fit today, keeping the resource\'s own context; check every answer. practice: exactly 3 problems, easy to hard, each with its answer.',
    "- watch_for: exactly 2 misconceptions about TODAY's skill, each stated in ONE plain sentence. Do not write example wrong work.",
    '- Do not repeat another day\'s opening task: use the part of the resources that fits THIS day\'s job.',
    "- Solve every worked example and practice problem step by step before writing it; each answer must match your working. Write numeric answers as 'expression = value' where it helps (e.g. '3 ÷ 12 = 0.25').",
    `- Differentiation: for each group in ${JSON.stringify(groups)}, give one specific move on the MAIN task segment (Explore or Apply); other segments only where it truly differs. Name the tool, task, prompt or sentence frame. Generic phrases such as ${GENERIC} are not allowed.`,
    "- Keep the meaning of 'more' consistent with the rest of the unit's context (say which quantity is per which).",
    '',
    'Return ONLY JSON of this shape (values are instructions, replace them):',
    schema,
  ].join('\n');
}

/** The whole class-day prompt in one string (shared context + day part). */
export function buildLessonPlanPrompt(config: PlanConfig, resourcesText: string, day?: DayContext): string {
  return `${buildSharedContext(config, resourcesText)}\n\n${buildLessonDayPrompt(config, day)}`;
}

/**
 * An Independent Learning Day: students work on their own and there is no
 * class session, so there are no teacher moves or segments to write. The
 * reply is a fraction of a teaching day's length, so the day costs less.
 * This is the day-specific part; the shared context goes before it.
 */
export function buildIldDayPrompt(
  config: PlanConfig,
  day: DayContext & { name: string; reason?: string },
): string {
  const schema = `{
 "standard": "the specific standard code + short description",
 "wida": "WIDA ELD standard + brief language objective for independent work",
 "learning_target": "what students learn today, written to follow the template's own words 'Today, we are learning to:' (do not repeat that phrase)",
 "success_criteria": "'I can...' observable evidence",
 "instructional_resources": "the exact assignment/worksheet/platform named in the resources",
 "student_directions": "ONE string: 3-6 short steps a student follows alone, numbered '1. ... 2. ...' on separate lines",
 "assignment": "ONE string: 5-8 problems numbered '1. ... 2. ...' on separate lines, easy to hard",
 "answer_key": "ONE string: the answer to each numbered problem, same numbers, worked where a step matters"
}`;
  return [
    'Write ONE Independent Learning Day for this weekly math lesson plan, using the class context and resources above.',
    'There is NO class session this day: no teacher actions, no segments, no co-teaching.',
    'Students complete the assignment independently (at home or on a platform).',
    '',
    'THIS DAY:',
    `- Day: ${day.name}${day.dateLabel ? ` (${day.dateLabel})` : ''}`,
    ...(day.reason ? [`- Teacher's note: ${day.reason}`] : []),
    ...(day.weekOverview ? [`- The whole week (context only): ${day.weekOverview}`] : []),
    '',
    'RULES:',
    "- Take the assignment from the resources: the day's named assignment (e.g. an ILD worksheet) or the unit's reproducibles. No outside contexts or figures that are not in the resources.",
    '- Every value is a single string, never a list. Number items inside the string.',
    '- The assignment is required: write the actual problems with their numbers, not a description of them.',
    '- Vary the numbers so the problems have DIFFERENT answers; comparison problems must have a clear winner.',
    '- Solve every assignment item yourself before writing its answer; the answer key must match.',
    '- Ground the standard in the resources. Do not invent standards.',
    '',
    'Return ONLY JSON of this shape (values are instructions, replace them):',
    schema,
  ].join('\n');
}

/** The whole ILD prompt in one string (shared context + day part). */
export function buildIldPrompt(
  config: PlanConfig,
  resourcesText: string,
  day: DayContext & { name: string; reason?: string },
): string {
  return `${buildSharedContext(config, resourcesText)}\n\n${buildIldDayPrompt(config, day)}`;
}

/**
 * Close a JSON object that stopped mid-flight.
 *
 * A week of plans is long, and a reply clipped at max_tokens ends inside a
 * string or an array — valid so far, just unfinished. Rather than throw away
 * four days of work because the fifth is incomplete, drop back to the last
 * balanced point and shut the structure cleanly. Better a plan missing its
 * tail, which the teacher can see and fix, than a red banner and no plan.
 */
function repairTruncatedJson(src: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastSafe = -1;
  const stack: string[] = [];

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') { stack.push(c === '{' ? '}' : ']'); depth++; }
    else if (c === '}' || c === ']') { stack.pop(); depth--; }
    // A comma at the top of an array is a clean seam between whole items.
    else if (c === ',' && depth > 0) lastSafe = i;
  }

  if (stack.length === 0) return null; // not truncated; nothing to repair
  if (lastSafe < 0) return null;       // nothing whole to salvage

  // Re-walk to the seam so the closers match what is actually still open.
  const head = src.slice(0, lastSafe);
  const closers: string[] = [];
  let d = 0, str = false, esc = false;
  const open: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') { str = true; continue; }
    if (c === '{') { open.push('}'); d++; }
    else if (c === '[') { open.push(']'); d++; }
    else if (c === '}' || c === ']') { open.pop(); d--; }
  }
  while (open.length) closers.push(open.pop() as string);
  return head + closers.join('');
}

/**
 * Fix the slips models make inside JSON strings: an unescaped double quote
 * (a quote is taken as the string's end only when the next non-space
 * character is , } ] or :), raw line breaks and tabs, and trailing commas.
 */
export function repairJsonSlips(src: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += c;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      out += c;
      continue;
    }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r') { continue; }
    if (c === '\t') { out += '\\t'; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const next = src[j];
      if (next === undefined || next === ',' || next === '}' || next === ']' || next === ':') {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Extract the first JSON object from a model response. */
export function extractJson(text: string): Record<string, unknown> | null {
  let trimmed = (text ?? '').trim();
  // Models fence JSON even when told not to. Unwrap it before parsing.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) trimmed = fenced[1].trim();

  const match = trimmed.match(/\{[\s\S]*\}/);
  const candidates = [trimmed, match?.[0]];

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      return JSON.parse(cand) as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }

  // Common model slips in long replies: a double quote inside a string left
  // unescaped, a raw line break inside a string, a trailing comma. Seen on
  // 1 Nov 2026: complete replies (stop_reason end_turn) of 14-20k characters
  // rejected whole, losing the day.
  for (const cand of candidates) {
    if (!cand) continue;
    try {
      return JSON.parse(repairJsonSlips(cand)) as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }

  // Last resort: the reply was cut off. Salvage the complete days.
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    const repaired = repairTruncatedJson(trimmed.slice(start));
    if (repaired) {
      try {
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        /* give up */
      }
    }
  }
  return null;
}
