/**
 * Prompt construction for math weekly lesson-plan generation.
 * The model returns CONTENT only (no minute counts); pacing is applied
 * deterministically by the sidecar. Mirrors the reference Python generator.
 */

export const DIFF_GROUPS = ['ESOL', 'Gifted', 'SWD'] as const;

export const LESSON_PLAN_SYSTEM =
  'You are an expert K-12 mathematics instructional coach writing a weekly ' +
  'lesson plan for a district that uses the DCSD Mathematics Instructional ' +
  'Framework (phases: Pre-Instructional, Engage, Explore, Apply, Reflect). ' +
  'You write concrete, classroom-ready teacher moves and student moves, ' +
  'grounded ONLY in the provided resources (pacing guide, ILP, performance ' +
  'tasks, standards, roster data). Be specific to the math standards given. ' +
  'You never invent standards not supported by the resources. Output MUST be ' +
  'valid JSON matching the requested schema and nothing else.';

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
 * Where this one day sits in the week (Track LP1). Every day is drafted in its
 * own parallel call, so without this a day cannot know its date, that
 * yesterday was an Independent Learning Day, or that tomorrow is a test.
 */
export interface DayContext {
  /** e.g. "Tuesday, 3 Nov 2026". */
  dateLabel?: string;
  /** One line per day of the week: date, status, teacher's reason. */
  weekOverview?: string;
  /** Extra instruction for a test, centers or half day. */
  statusNote?: string;
}

export function buildLessonPlanPrompt(
  config: PlanConfig,
  resourcesText: string,
  day?: DayContext,
): string {
  const groups = config.differentiation_groups ?? [...DIFF_GROUPS];
  const diffSchema = groups
    .map((g) => `"${g}": "specific support for this group (omit groups not listed)"`)
    .join(', ');

  const schema = `{
 "days": [{
   "name": "one of the day names",
   "standard": "the specific standard code + short description for that day",
   "wida": "WIDA ELD standard + brief content/language objective",
   "learning_target": "student-friendly 'Today, we are learning to...' statement",
   "success_criteria": "'I can...' observable evidence",
   "instructional_resources": "specific texts/materials/tasks used that day",
   "segments": [{
     "lesson_component": "one of: Pre-Instructional, Engage, Explore, Apply, Reflect",
     "teacher_actions": "concrete teacher moves for this phase",
     "student_actions": "what students do this phase",
     "academic_vocabulary": "key terms",
     "writing_strategies": "a writing-to-learn move",
     "assessment_strategies": "how understanding is checked this phase",
     "differentiation": { ${diffSchema} }
   }]
 }],
 "small_group": [{
   "rationale": "data point driving this group", "identifier": "e.g. Tier 2",
   "skill": "target skill", "strategy": "approach", "activity": "the task"
 }]
}`;

  return [
    'Create a weekly math lesson plan.',
    '',
    'CONTEXT:',
    `- Grade/Course: ${config.grade ?? ''}`,
    `- Unit: ${config.unit ?? ''}`,
    `- Week of: ${config.week ?? ''}`,
    `- Period length: ${config.period_minutes} minutes (IMPORTANT for pacing)`,
    `- Days to plan (produce exactly these, in order): ${JSON.stringify(config.days)}`,
    ...(day?.dateLabel ? [`- Date of this day: ${day.dateLabel}`] : []),
    ...(day?.weekOverview
      ? [
          `- The whole week (for context only; plan just the day above): ${day.weekOverview}`,
          '- Never describe a no-school or independent-learning day as a class session, and refer to other days by their status above.',
        ]
      : []),
    ...(day?.statusNote ? [`- ${day.statusNote}`] : []),
    `- Segments per day (produce EXACTLY this many per day): ${config.segments_per_day}`,
    `- Co-teaching/para: ${config.co_teaching ?? 'None'} (if not None, split teacher_actions by role: 'Teacher 1: ... Teacher 2: ...')`,
    `- Differentiation groups the teacher has (fill ONLY these, where warranted): ${JSON.stringify(groups)}`,
    `- Strategies to weave in where appropriate (not forced): ${JSON.stringify(config.strategies ?? [])}`,
    ...(config.instructions && config.instructions.trim()
      ? [
          '',
          "TEACHER'S SPECIFIC INSTRUCTIONS (high priority — honor these; weave them into teacher_actions, instructional_resources, and differentiation wherever they apply, without breaking the required structure or inventing standards not in the resources):",
          config.instructions.trim(),
        ]
      : []),
    '',
    'RESOURCES (plan strictly from these):',
    resourcesText.slice(0, 12000),
    '',
    'RULES:',
    `- Each day has EXACTLY ${config.segments_per_day} segments; choose the most appropriate framework phases and sequence them coherently across the week.`,
    `- Differentiation: include a key ONLY for a group in ${JSON.stringify(groups)}, and only when warranted; otherwise omit it.`,
    '- Do not include minute counts; pacing is computed separately.',
    '- Ground every standard/target in the resources.',
    '',
    'Return ONLY JSON of this shape (values are instructions, replace them):',
    schema,
  ].join('\n');
}

/**
 * An Independent Learning Day: students work on their own and there is no
 * class session, so there are no teacher moves or segments to write. The
 * reply is a fraction of a teaching day's length, so the day costs less.
 */
export function buildIldPrompt(
  config: PlanConfig,
  resourcesText: string,
  day: DayContext & { name: string; reason?: string },
): string {
  const schema = `{
 "standard": "the specific standard code + short description",
 "wida": "WIDA ELD standard + brief language objective for independent work",
 "learning_target": "what students learn today, written to follow the template's own words 'Today, we are learning to:' (do not repeat that phrase)",
 "success_criteria": "'I can...' observable evidence",
 "instructional_resources": "the exact assignment/worksheet/platform named in the resources",
 "student_directions": "3-6 short numbered steps a student follows at home or alone, in plain language",
 "assignment": "the tasks or problems, numbered, at the right difficulty (5-8 items)",
 "answer_key": "the answer to every numbered item, worked where a step matters"
}`;
  return [
    'Write ONE Independent Learning Day for a weekly math lesson plan.',
    'There is NO class session this day: no teacher actions, no segments, no co-teaching.',
    'Students complete the assignment independently (at home or on a platform).',
    '',
    'CONTEXT:',
    `- Grade/Course: ${config.grade ?? ''}`,
    `- Unit: ${config.unit ?? ''}`,
    `- Day: ${day.name}${day.dateLabel ? ` (${day.dateLabel})` : ''}`,
    ...(day.reason ? [`- Teacher's note: ${day.reason}`] : []),
    ...(day.weekOverview ? [`- The whole week (context only): ${day.weekOverview}`] : []),
    ...(config.instructions && config.instructions.trim()
      ? ["- Teacher's instructions (honor where they apply to this day):", config.instructions.trim()]
      : []),
    '',
    'RESOURCES (plan strictly from these; if they name an assignment for this day, use it):',
    resourcesText.slice(0, 12000),
    '',
    'RULES:',
    '- Solve every assignment item yourself before writing its answer; the answer key must match.',
    '- Ground the standard in the resources. Do not invent standards.',
    '',
    'Return ONLY JSON of this shape (values are instructions, replace them):',
    schema,
  ].join('\n');
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
