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
}

export function buildLessonPlanPrompt(
  config: PlanConfig,
  resourcesText: string,
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
    `- Segments per day (produce EXACTLY this many per day): ${config.segments_per_day}`,
    `- Co-teaching/para: ${config.co_teaching ?? 'None'} (if not None, split teacher_actions by role: 'Teacher 1: ... Teacher 2: ...')`,
    `- Differentiation groups the teacher has (fill ONLY these, where warranted): ${JSON.stringify(groups)}`,
    `- Strategies to weave in where appropriate (not forced): ${JSON.stringify(config.strategies ?? [])}`,
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

/** Extract the first JSON object from a model response. */
export function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = (text ?? '').trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  for (const cand of [trimmed, match?.[0]]) {
    if (!cand) continue;
    try {
      return JSON.parse(cand) as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return null;
}
