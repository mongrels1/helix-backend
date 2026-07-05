import type { Rng } from './rng';

/**
 * Backend mirror of the frontend Figure JSON shape (see
 * helix-frontend/src/components/figures/figure.ts). The backend only produces the
 * JSON spec; the frontend renders it. Field names MUST match exactly.
 */
export type Pt = { x: number; y: number };

export type Figure =
  | { type: 'coordinate_grid'; min: number; max: number; points: { x: number; y: number; label?: string }[]; altText?: string }
  | { type: 'transformation'; min: number; max: number; preimage: Pt[]; image: Pt[]; kind?: 'translation' | 'reflection' | 'rotation' | 'dilation'; showImage?: boolean; note?: string; altText?: string }
  | { type: 'right_triangle'; a: number; b: number; labelA?: string; labelB?: string; labelC?: string; altText?: string }
  | { type: 'cylinder'; r: number; h: number; rLabel?: string; hLabel?: string; altText?: string }
  | { type: 'cone'; r: number; h: number; rLabel?: string; hLabel?: string; altText?: string }
  | { type: 'sphere'; r: number; rLabel?: string; altText?: string }
  | { type: 'number_line'; min: number; max: number; ticks?: number; marks?: { at: number; label?: string }[]; altText?: string };

export interface DiagOption {
  text: string;
  correct: boolean;
  misconception?: string;
}

export interface DeterministicItem {
  standard: string;   // GA cluster, e.g. '8.GSR.8'
  grade: number;
  strand: string;     // 'G', 'NS', ...
  kc: string;         // short skill name
  stem: string;       // one plain sentence referencing the figure in words
  options: DiagOption[]; // exactly 4, exactly one correct, all distinct
  answer: string;     // the correct option's text
  figure?: Figure;
  dok: number;        // 1..4
  b: number;          // difficulty -2..2
}

export interface ItemModel {
  id: string;
  standard: string;
  grade: number;
  strand: string;
  /** Pure + deterministic given rng. No I/O, no LLM. Returns null if this seed
   *  produced a degenerate item (e.g. an option collision) — the caller re-seeds. */
  generate(rng: Rng): DeterministicItem | null;
}

/** Assemble 4 options from a correct text + three misconception distractors,
 *  shuffled. Returns null if they aren't 4 distinct texts (caller re-seeds). */
export function buildOptions(
  rng: Rng,
  correct: string,
  distractors: { text: string; misconception: string }[],
): DiagOption[] | null {
  const texts = new Set([correct, ...distractors.map((d) => d.text)]);
  if (texts.size !== 4) return null; // a collision — let the caller try another seed
  return rng.shuffle([
    { text: correct, correct: true },
    ...distractors.map((d) => ({ text: d.text, correct: false, misconception: d.misconception })),
  ]);
}
