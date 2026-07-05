/**
 * Deterministic item models. Each computes the correct answer from the SAME
 * numbers it puts in the figure, and builds distractors from NAMED misconceptions.
 * Correct + labeled + coherent by construction — no LLM, no dice-roll.
 */
import type { Rng } from './rng';
import type { DeterministicItem, ItemModel, Pt } from './types';
import { buildOptions } from './types';

const GA_G = '8.GSR.8';
const GA_NS = '8.NR.1';

// Pythagorean triples (leg, leg, hyp) for clean integer distances/hypotenuses.
const TRIPLES: [number, number, number][] = [
  [3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [7, 24, 25], [20, 21, 29],
];

const P = (p: Pt) => `(${p.x}, ${p.y})`;

// ---------------------------------------------------------------------------
// 8.G — Transformations (reflection / rotation / translation) — find B'
// ---------------------------------------------------------------------------

function triangleInQuadrant(rng: Rng): Pt[] {
  const A = { x: rng.int(1, 4), y: rng.int(2, 6) };
  const B = { x: A.x + rng.int(1, 3), y: A.y + rng.int(1, 2) };
  const C = { x: A.x + rng.int(0, 1), y: A.y + rng.int(2, 3) };
  return [A, B, C];
}

const reflectAcrossAxis: ItemModel = {
  id: 'reflect-across-axis', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const axis = rng.pick(['x', 'y'] as const);
    const pre = triangleInQuadrant(rng);
    const refl = (p: Pt): Pt => (axis === 'x' ? { x: p.x, y: -p.y } : { x: -p.x, y: p.y });
    const img = pre.map(refl);
    const B = pre[1];
    const correct = P(refl(B));
    const options = buildOptions(rng, correct, [
      { text: P(axis === 'x' ? { x: -B.x, y: B.y } : { x: B.x, y: -B.y }), misconception: 'Reflected across the wrong axis' },
      { text: P(B), misconception: 'Did not apply the reflection' },
      { text: P({ x: -B.x, y: -B.y }), misconception: 'Rotated 180° instead of reflecting' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: `Reflect across the ${axis}-axis`,
      stem: `Triangle ABC (shown on the grid) is reflected across the ${axis}-axis. What are the coordinates of B'?`,
      options, answer: correct, dok: 2, b: 0,
      figure: { type: 'transformation', min: -8, max: 8, preimage: pre, image: img, kind: 'reflection', showImage: false, note: `Reflect across the ${axis}-axis` },
    };
  },
};

const rotateAboutOrigin: ItemModel = {
  id: 'rotate-about-origin', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const deg = rng.pick([90, 180, 270] as const);
    const pre = triangleInQuadrant(rng);
    const rot = (p: Pt, d: number): Pt =>
      d === 90 ? { x: -p.y, y: p.x } : d === 180 ? { x: -p.x, y: -p.y } : { x: p.y, y: -p.x };
    const img = pre.map((p) => rot(p, deg));
    const B = pre[1];
    const correct = P(rot(B, deg));
    const other = deg === 180 ? 90 : 180;
    const options = buildOptions(rng, correct, [
      { text: P(rot(B, other)), misconception: `Rotated ${other}° instead of ${deg}°` },
      { text: P({ x: B.x, y: -B.y }), misconception: 'Reflected across the x-axis instead of rotating' },
      { text: P(B), misconception: 'Did not apply the rotation' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: `Rotate ${deg}° about the origin`,
      stem: `Triangle ABC (shown on the grid) is rotated ${deg}° counterclockwise about the origin. What are the coordinates of B'?`,
      options, answer: correct, dok: 2, b: 0.3,
      figure: { type: 'transformation', min: -8, max: 8, preimage: pre, image: img, kind: 'rotation', showImage: false, note: `Rotate ${deg}° about the origin` },
    };
  },
};

const translatePolygon: ItemModel = {
  id: 'translate-polygon', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    let dx = rng.int(-5, 5), dy = rng.int(-5, 5);
    if (dx === 0) dx = 2;
    if (dy === 0) dy = -3;
    if (dx === dy) dy = -dy || 3;
    const pre = triangleInQuadrant(rng);
    const tr = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
    const img = pre.map(tr);
    const B = pre[1];
    const correct = P(tr(B));
    const xs = dx >= 0 ? `right ${dx}` : `left ${-dx}`;
    const ys = dy >= 0 ? `up ${dy}` : `down ${-dy}`;
    const options = buildOptions(rng, correct, [
      { text: P({ x: B.x - dx, y: B.y - dy }), misconception: 'Subtracted the translation instead of adding' },
      { text: P({ x: B.x + dy, y: B.y + dx }), misconception: 'Swapped the horizontal and vertical shifts' },
      { text: P(B), misconception: 'Did not apply the translation' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Translate a polygon',
      stem: `Triangle ABC (shown on the grid) is translated ${xs} and ${ys}. What are the coordinates of B'?`,
      options, answer: correct, dok: 2, b: -0.2,
      figure: { type: 'transformation', min: -8, max: 8, preimage: pre, image: img, kind: 'translation', showImage: false, note: `Translate ${xs}, ${ys}` },
    };
  },
};

// ---------------------------------------------------------------------------
// 8.G — Distance between two points (coordinate plane)
// ---------------------------------------------------------------------------

// Small triples only, so both points fit on a readable grid.
const SMALL_TRIPLES: [number, number, number][] = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17]];

const distanceCoordinate: ItemModel = {
  id: 'distance-coordinate', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const [p, q, r] = rng.pick(SMALL_TRIPLES);
    // orient the legs randomly (±x, ±y) but keep both points on-grid
    const sx = rng.bool() ? 1 : -1;
    const sy = rng.bool() ? 1 : -1;
    const A = { x: rng.int(-2, 2), y: rng.int(-2, 2) };
    const B = { x: A.x + sx * p, y: A.y + sy * q };
    const correct = `${r} units`;
    const options = buildOptions(rng, correct, [
      { text: `${p + q} units`, misconception: 'Added the legs instead of using the Pythagorean theorem' },
      { text: `${Math.max(p, q)} units`, misconception: 'Used only one leg (the longer side)' },
      { text: `${p * p + q * q} units`, misconception: 'Forgot the square root' },
    ]);
    if (!options) return null;
    const lo = Math.min(A.x, A.y, B.x, B.y) - 1;
    const hi = Math.max(A.x, A.y, B.x, B.y) + 1;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Distance between two points',
      stem: 'What is the distance between the two points shown on the coordinate grid?',
      options, answer: correct, dok: 2, b: 0.4,
      figure: { type: 'coordinate_grid', min: lo, max: hi, points: [{ x: A.x, y: A.y, label: `(${A.x}, ${A.y})` }, { x: B.x, y: B.y, label: `(${B.x}, ${B.y})` }] },
    };
  },
};

// ---------------------------------------------------------------------------
// 8.G — Pythagorean theorem (find the hypotenuse)
// ---------------------------------------------------------------------------

const pythagoreanHypotenuse: ItemModel = {
  id: 'pythagorean-hypotenuse', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const [a, b, c] = rng.pick(TRIPLES);
    const correct = `${c}`;
    const options = buildOptions(rng, correct, [
      { text: `${a + b}`, misconception: 'Added the legs instead of using a² + b² = c²' },
      { text: `${a * a + b * b}`, misconception: 'Forgot to take the square root' },
      { text: `${Math.max(a, b)}`, misconception: 'Used only the longer leg' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Pythagorean theorem — hypotenuse',
      stem: `A right triangle has legs of length ${a} and ${b}. What is the length of the hypotenuse?`,
      options, answer: correct, dok: 2, b: 0.1,
      figure: { type: 'right_triangle', a, b, labelA: `${a}`, labelB: `${b}`, labelC: 'c' },
    };
  },
};

// ---------------------------------------------------------------------------
// 8.G — Volume of a cylinder / cone / sphere (in terms of π)
// ---------------------------------------------------------------------------

const volumeCylinder: ItemModel = {
  id: 'volume-cylinder', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const r = rng.pick([4, 5, 6]); // avoids r²h == 2rh == rh collisions
    const h = rng.int(2, 9);
    const correct = `${r * r * h}π cubic cm`;
    const options = buildOptions(rng, correct, [
      { text: `${2 * r * h}π cubic cm`, misconception: 'Used the lateral surface formula (2πrh)' },
      { text: `${r * h}π cubic cm`, misconception: 'Forgot to square the radius' },
      { text: `${4 * r * r * h}π cubic cm`, misconception: 'Used the diameter instead of the radius' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Volume of a cylinder',
      stem: `A cylinder has radius ${r} cm and height ${h} cm. What is its volume, in terms of π?`,
      options, answer: correct, dok: 2, b: 0,
      figure: { type: 'cylinder', r, h, rLabel: `${r} cm`, hLabel: `${h} cm` },
    };
  },
};

const volumeCone: ItemModel = {
  id: 'volume-cone', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const r = rng.pick([3, 6, 9]); // r² divisible by 3 → integer coefficient
    const h = rng.int(2, 9);
    const coef = (r * r * h) / 3;
    const correct = `${coef}π cubic cm`;
    const options = buildOptions(rng, correct, [
      { text: `${r * r * h}π cubic cm`, misconception: 'Used the cylinder formula (forgot the ⅓)' },
      { text: `${r * h}π cubic cm`, misconception: 'Forgot to square the radius' },
      { text: `${2 * coef}π cubic cm`, misconception: 'Doubled instead of using ⅓' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Volume of a cone',
      stem: `A cone has radius ${r} cm and height ${h} cm. What is its volume, in terms of π?`,
      options, answer: correct, dok: 2, b: 0.3,
      figure: { type: 'cone', r, h, rLabel: `${r} cm`, hLabel: `${h} cm` },
    };
  },
};

const volumeSphere: ItemModel = {
  id: 'volume-sphere', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const r = rng.pick([3, 6, 9]); // r³ divisible by 3 → integer coefficient
    const coef = (4 * r * r * r) / 3;
    const correct = `${coef}π cubic cm`;
    const options = buildOptions(rng, correct, [
      { text: `${4 * r * r}π cubic cm`, misconception: 'Used the surface-area formula (4πr²)' },
      { text: `${(r * r * r)}π cubic cm`, misconception: 'Forgot the 4/3 factor' },
      { text: `${(4 * r * r * r)}π cubic cm`, misconception: 'Forgot to divide by 3' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Volume of a sphere',
      stem: `A sphere has radius ${r} cm. What is its volume, in terms of π?`,
      options, answer: correct, dok: 3, b: 0.6,
      figure: { type: 'sphere', r, rLabel: `${r} cm` },
    };
  },
};

// ---------------------------------------------------------------------------
// 8.NS — Distance on a number line (NUMBER SENSE, not geometry)
// ---------------------------------------------------------------------------

const distanceNumberLine: ItemModel = {
  id: 'distance-number-line', standard: GA_NS, grade: 8, strand: 'NS',
  generate(rng) {
    const a = rng.int(-8, 2);
    const dist = rng.int(3, 10);
    const b = a + dist;
    const correct = `${dist} units`;
    const options = buildOptions(rng, correct, [
      { text: `${dist + 1} units`, misconception: 'Counted the tick marks instead of the gaps' },
      { text: `${Math.abs(a + b)} units`, misconception: 'Added the two values instead of subtracting' },
      { text: `${Math.max(1, dist - 1)} units`, misconception: 'Off-by-one counting error' },
    ]);
    if (!options) return null;
    const lo = Math.min(a, b) - 1;
    const hi = Math.max(a, b) + 1;
    return {
      standard: GA_NS, grade: 8, strand: 'NS', kc: 'Distance on a number line',
      stem: 'What is the distance between the two points shown on the number line?',
      options, answer: correct, dok: 1, b: -0.8,
      figure: { type: 'number_line', min: lo, max: hi, ticks: 1, marks: [{ at: a, label: `${a}` }, { at: b, label: `${b}` }] },
    };
  },
};

export const ITEM_MODELS: ItemModel[] = [
  reflectAcrossAxis,
  rotateAboutOrigin,
  translatePolygon,
  distanceCoordinate,
  pythagoreanHypotenuse,
  volumeCylinder,
  volumeCone,
  volumeSphere,
  distanceNumberLine,
];

export function modelsFor(grade: number, strand?: string): ItemModel[] {
  return ITEM_MODELS.filter((m) => m.grade === grade && (!strand || strand === 'all' || m.strand === strand));
}
