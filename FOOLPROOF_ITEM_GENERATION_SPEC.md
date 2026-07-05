# EdKairos — Foolproof Diagnostic Item Generation (Codex build spec)

**Goal:** Make every generated diagnostic/practice item that involves a figure *correct, labeled, and coherent by construction* — never a dice-roll. This spec is written to be executed by a coding agent (Codex) in one focused pass.

**Author's note (why this design):** An LLM asked to freehand a geometry item *and* author a figure spec that exactly encodes that item's data, in one shot, fails on the hard cases (reflections without axes, cones drawn as triangles, distances that don't match the plotted points, figures whose labels don't match the question). The fix is not a bigger model. It is to **remove the LLM from the computable standards entirely** and generate those items deterministically. The LLM stays only for open-ended word-problem wording, behind the existing correctness gate.

Runtime cost of the deterministic path is **zero LLM tokens**, which also serves the budget.

---

## 1. Scope

### 1a. Standards that MUST become deterministic (the ones failing today)
| Standard | Skill | Figure |
|---|---|---|
| 8.G (8.GSR.8) | Reflection of a polygon across an axis | `transformation` on a **labeled** grid |
| 8.G (8.GSR.8) | Rotation 90°/180°/270° about origin | `transformation` on a **labeled** grid |
| 8.G (8.GSR.8) | Translation by (dx, dy) | `transformation` on a **labeled** grid |
| 8.G (8.GSR.8) | Dilation about origin by scale k | `transformation` on a **labeled** grid |
| 8.G (8.GSR.8) | Pythagorean — find hypotenuse / leg | `right_triangle` with real side values |
| 8.G (8.GSR.8) | Distance between two points | `coordinate_grid` with **labeled** axes |
| 8.G (8.GSR.8) | Volume of cylinder / cone / sphere | `cylinder` / `cone` / `sphere` |
| 8.G (8.GSR.8) | Angle relationships (parallel lines + transversal) | **new** `parallel_lines` figure |
| 8.NS / 8.NR | Distance on a number line | `number_line` (retag — this is **number sense, not geometry**) |

### 1b. Standards that STAY LLM-based
Everything non-computable (contextual word problems, interpretation, multi-step reasoning). These keep the existing pipeline: LLM generation → `sanitizeFigure` guard → `factCheck` gate → `verifyDiagnostic`. Optionally raise their generation model, but that is out of scope for "foolproof."

---

## 2. Architecture

Create `src/intelligence/diagnostic-bank/item-models/`.

### 2a. The contract (`types.ts`)
```ts
import type { Figure } from './figure-spec'; // mirror of the frontend Figure union (JSON shape)

export interface DeterministicItem {
  standard: string;         // GA cluster, e.g. '8.GSR.8'
  grade: number;            // 8
  strand: string;           // 'G'
  kc: string;               // short skill name, e.g. 'Reflect across x-axis'
  stem: string;             // ONE plain sentence; references the figure in words
  options: { text: string; correct: boolean; misconception?: string }[]; // EXACTLY 4, EXACTLY one correct
  answer: string;           // the correct option's text
  figure?: Figure;          // typed spec; built by code, never by an LLM
  dok: number;              // 1..4
  b: number;                // difficulty -2..2
}

export interface ItemModel {
  id: string;               // stable, e.g. 'reflect-across-axis'
  standard: string;
  grade: number;
  strand: string;
  /** Pure + deterministic given rng. No I/O, no LLM. */
  generate(rng: Rng): DeterministicItem;
}

/** Seeded RNG so a run is reproducible and variety is controlled. */
export interface Rng {
  int(min: number, max: number): number;   // inclusive
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[];
}
```

### 2b. Seeded RNG (`rng.ts`)
Implement a small deterministic PRNG (mulberry32 or xorshift). `makeRng(seed: number): Rng`. Seeds are **never stored** (consistent with current design) — they only drive one generation.

### 2c. Figure spec on the backend (`figure-spec.ts`)
The backend currently emits figure JSON that the frontend `components/figures` renders. Mirror the **exact** JSON shape of the frontend `Figure` union here as TypeScript types so item-models are type-safe. Do **not** redraw anything on the backend — it only produces the JSON spec. Keep field names identical to `helix-frontend/src/components/figures/figure.ts`.

### 2d. Registry (`registry.ts`)
```ts
export const ITEM_MODELS: ItemModel[] = [ /* one per skill */ ];
export function modelsFor(grade: number, strand?: string): ItemModel[] { ... }
```

### 2e. Correctness by construction — the core rule
Each model computes the **correct answer from the same numbers it puts in the figure**, then builds **three distractors from named misconceptions** (not random). Example misconceptions:
- Reflection across x-axis → correct `(x, -y)`; distractors: `(-x, y)` "reflected across the wrong axis", `(x, y)` "forgot to reflect", `(-x, -y)` "rotated 180° instead".
- Distance → correct `√(Δx²+Δy²)`; distractors: `|Δx|+|Δy|` "added instead of Pythagorean", `|Δx|` or `|Δy|` "used one leg", `Δx²+Δy²` "forgot the square root".
- Volume of cylinder → correct `πr²h`; distractors: `2πrh` "used surface/lateral", `πrh` "forgot to square r", `⅓πr²h` "used cone formula".

This is what makes them real **diagnostic** items: every wrong answer maps to a real student error, tagged.

---

## 3. Renderer fixes (frontend — required, deterministic)

These are real defects, independent of generation:

1. **Labeled axes on `coordinate_grid` and `transformation`.** Both must draw the x- and y-axis with integer tick numbers, and label each plotted vertex (A, B, C…). Today the reflection grid renders gridlines with no axis numbers, so "reflect about the x-axis" is unreadable. File: `helix-frontend/src/components/figures/figures/Transformation.tsx` and `CoordinateGrid.tsx`.
2. **"Find the coordinates" transformation items show ONLY the pre-image.** The image is the answer — do not draw it. Add an optional `showImage?: boolean` to `TransformationFigure` (default true); deterministic "find the image coordinates" models set it `false`.
3. **New `parallel_lines` figure type** for angle-relationship items: two parallel lines cut by a transversal, one angle labeled with a value/expression, the target angle marked `x`. Add the type to `figure.ts` (interface + parse + altText + `FIGURE_TYPES`), a `ParallelLines.tsx` renderer, and wire into `FigureRenderer.tsx` + `index.ts`.
4. **Exclude "which graph is the image" multiple-choice-of-graphs format** — options that are themselves graphs don't render. Deterministic transformation items must ask for **coordinates**, not "which graph."

---

## 4. Worked example — reflection across an axis (`models/reflect-across-axis.ts`)

```ts
import type { ItemModel, DeterministicItem, Rng } from '../types';

export const reflectAcrossAxis: ItemModel = {
  id: 'reflect-across-axis',
  standard: '8.GSR.8',
  grade: 8,
  strand: 'G',
  generate(rng: Rng): DeterministicItem {
    const axis = rng.pick(['x', 'y'] as const);
    // pre-image triangle vertices in a readable quadrant, integer coords
    const A = { x: rng.int(1, 4), y: rng.int(2, 6) };
    const B = { x: A.x + rng.int(1, 3), y: A.y };
    const C = { x: A.x, y: A.y + rng.int(1, 3) };
    const pre = [A, B, C];
    const refl = (p: { x: number; y: number }) =>
      axis === 'x' ? { x: p.x, y: -p.y } : { x: -p.x, y: p.y };
    const img = pre.map(refl);

    // correct answer + misconception distractors, computed from the SAME points
    const fmt = (p: { x: number; y: number }) => `(${p.x}, ${p.y})`;
    const correct = fmt(img[1]); // ask for B'
    const wrongAxis = fmt(axis === 'x' ? { x: -B.x, y: B.y } : { x: B.x, y: -B.y });
    const noChange = fmt(B);
    const rot180 = fmt({ x: -B.x, y: -B.y });

    const options = rng.shuffle([
      { text: correct, correct: true },
      { text: wrongAxis, correct: false, misconception: 'Reflected across the wrong axis' },
      { text: noChange, correct: false, misconception: 'Did not apply the reflection' },
      { text: rot180, correct: false, misconception: 'Rotated 180° instead of reflecting' },
    ]);

    return {
      standard: '8.GSR.8', grade: 8, strand: 'G',
      kc: `Reflect across the ${axis}-axis`,
      stem: `Triangle ABC is reflected across the ${axis}-axis. What are the coordinates of B'?`,
      options, answer: correct,
      figure: {
        type: 'transformation',
        min: -8, max: 8,
        preimage: pre, image: img,
        kind: 'reflection',
        showImage: false,          // find-the-coordinates: hide the answer
        note: `Reflect across the ${axis}-axis`,
      },
      dok: 2, b: 0,
    };
  },
};
```
Note: every option is derived from `A/B/C`; the figure uses the same points; the axes are labeled by the renderer. There is no way for this item to be wrong.

---

## 5. Service + endpoint wiring

- `diagnostic-bank.service.ts`: add
  ```ts
  async generateDeterministic(body: { grade: number; strand?: string; count?: number }, createdBy?: string)
  ```
  which draws `count` items by cycling `modelsFor(grade, strand)` with fresh seeds, runs each through the existing `factCheck` (belt-and-suspenders), and `createMany` as drafts. No `verifyDiagnostic` call needed for deterministic items (they're correct by construction) — but keep `factCheck` as a cheap final assertion.
- `diagnostic-bank.controller.ts`: `@Post('generate-deterministic')`.
- Frontend `DiagnosticBankPage.tsx`: the existing "Generate items" panel gets a source toggle — **"Deterministic (geometry/number)"** vs **"AI (word problems)"** — deterministic calls the new endpoint.

---

## 6. Acceptance tests (`item-models/*.spec.ts`) — Codex must write these

For each model, over 200 random seeds, assert:
1. Exactly 4 options, exactly one `correct: true`, no duplicate option texts.
2. An **independent** re-derivation of the answer (write the math a second, different way) equals the `correct` option.
3. If the standard is visual, `figure` is present and its data matches the numbers in the stem/answer.
4. Every distractor has a non-empty `misconception`.
5. Coordinate/transformation figures carry axis bounds that include all plotted points.

CI gate: all property tests green before merge.

---

## 7. File-by-file task list for Codex

Backend (`helix-backend`):
1. `src/intelligence/diagnostic-bank/item-models/rng.ts` — seeded PRNG.
2. `.../item-models/figure-spec.ts` — backend mirror of the frontend `Figure` union (JSON shape only).
3. `.../item-models/types.ts` — `ItemModel`, `DeterministicItem`.
4. `.../item-models/models/` — one file per skill in §1a (reflection, rotation, translation, dilation, pythagorean, distance-coordinate, distance-numberline→8.NS, volume-cylinder, volume-cone, volume-sphere, angle-parallel-lines).
5. `.../item-models/registry.ts` — `ITEM_MODELS`, `modelsFor`.
6. `diagnostic-bank.service.ts` — `generateDeterministic(...)`; reuse `factCheck`.
7. `diagnostic-bank.controller.ts` — `@Post('generate-deterministic')`.
8. `.../item-models/*.spec.ts` — property tests (§6).

Frontend (`helix-frontend`):
9. `components/figures/figure.ts` — add `showImage?` to `TransformationFigure`; add `ParallelLinesFigure` (interface + parse + altText + `FIGURE_TYPES`).
10. `components/figures/figures/Transformation.tsx` — draw labeled axes + vertex labels; honor `showImage`.
11. `components/figures/figures/CoordinateGrid.tsx` — draw labeled axes + tick numbers.
12. `components/figures/figures/ParallelLines.tsx` — new renderer; wire into `FigureRenderer.tsx` + `index.ts`.
13. `pages/super-admin/DiagnosticBankPage.tsx` — source toggle (Deterministic vs AI).

---

## 8. Guardrails Codex must preserve (already in the codebase)
- `sanitizeFigure` (figure↔stem type match) and `factCheck` (drops figure-referencing-with-no-figure, recomputes coordinate distance) — keep both; run deterministic items through `factCheck`.
- Items land as **drafts** only; human Validate/Reject gate is untouched. Never auto-publish.
- Seeds/source questions are never persisted.
- Commit identity: `git -c user.email=netstock@aol.com -c user.name="John Edwards"`.

---

## 9. Definition of done
- Generating any 8.G item via the deterministic path yields a correct, labeled, coherent figure and a correct answer on **every** seed (property tests prove it).
- The number-line-distance item is tagged 8.NS, not 8.G.
- No coordinate/transformation figure renders without labeled axes.
- The AI path is untouched for non-computable standards.
