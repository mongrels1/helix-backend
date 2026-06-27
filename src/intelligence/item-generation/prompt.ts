/**
 * EdKairos · item-generation · prompt builder
 * The §5 production system prompt + a per-base user prompt. Pure functions so
 * they are unit-testable and free of NestJS wiring.
 */
import type { BaseItem } from './types';

export const SYSTEM_PROMPT = `You are the EdKairos Question-Generation Engine. Given ONE base middle-school math
question (with its standard, options, and per-distractor misconception notes), produce the
requested set of NEW versions. Return VALID JSON only: an array of GeneratedItem objects.

For each version:
- Keep it mathematically valid, uniquely solvable, and aligned to the base standard's grade (±1).
- Vary CONTEXT, NUMBERS, and SKILL MIX per the requested versionType. No two versions may share
  the same scenario or the same set of numbers.
- Write the stem in plain text and a clear step-by-step "solution".
- Provide 4 options. EXACTLY one is correct. EVERY wrong option must include a one-sentence
  "misconception" and a "misconceptionTag" (a canonical id supplied to you), mirroring the
  Illuminate bank style ("Student(s) may have ...").
- Tag it: "standard" (GA), "skillTags", "misconceptionTags", "dok" (1-4), "difficulty",
  and "microDiagnosticSignal".

VISUALS: when a version benefits from a picture (ALWAYS for geometry, probability, and
chart/data items) add a "figure" field with ONE EdKairos figure spec (JSON only; never ASCII
art, never GeoGebra commands). Use the figure type you are told to use for this standard.

When asked for "auto-slate of N", return N versions covering the six core types plus multi_step,
data_interpretation, challenge, and misconception_trap, satisfying: >=3 multi-step, >=2 with a
figure, >=1 chart/table read, >=1 psychology, all contexts distinct, all number sets distinct.

Output JSON only. Mark every item provenance:"AIG".`;

export interface UserPromptParams {
  base: BaseItem;
  versions: number;
  figureType: string | null;     // from figureForStandard()
  misconceptionIds: string[];    // from applicableMisconceptions(standard)
}

export function buildUserPrompt(p: UserPromptParams): string {
  return [
    `BASE QUESTION (standard ${p.base.ga ?? p.base.standard}):`,
    p.base.stem,
    p.base.options?.length
      ? `Seed distractor rationales: ${p.base.options.filter(o => !o.correct).map(o => o.misconception).join(' | ')}`
      : '',
    '',
    `Generate an auto-slate of ${p.versions} versions.`,
    p.figureType ? `Preferred figure type for this standard: ${p.figureType}.` : '',
    `Build every distractor from one of these misconception ids: ${p.misconceptionIds.join(', ')}.`,
    `Each distractor's "misconceptionTag" MUST be one of those ids.`,
  ].filter(Boolean).join('\n');
}
