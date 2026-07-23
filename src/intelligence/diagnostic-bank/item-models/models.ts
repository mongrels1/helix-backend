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
    const r = rng.pick([6, 9, 12]); // r divisible by 3 → integer coef; r>3 avoids r²h/3 == r·h collision
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
    const r = rng.pick([6, 9, 12]); // r divisible by 3 → integer coef; r>3 avoids 4r³/3 == 4r² collision
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
// 8.G.7 — Pythagorean, real-world: ladder against a wall (find the height).
// This is a NUMBER-SWAP CLONE of the source item (Item 54239): same wording,
// same real-world scene, same distractor logic — only the numbers move.
// ---------------------------------------------------------------------------

const ladderPythagorean: ItemModel = {
  id: 'ladder-pythagorean', standard: GA_G, grade: 8, strand: 'G',
  generate(rng) {
    const [l1, l2, hyp] = rng.pick(TRIPLES);
    const base = Math.min(l1, l2);   // distance from the wall (ground)
    const height = Math.max(l1, l2); // how high the ladder reaches (the answer, x)
    const correct = `${height} m`;
    const options = buildOptions(rng, correct, [
      { text: `√${hyp * hyp + base * base} m`, misconception: 'Added the two squared terms (a²+c²=b²) instead of subtracting them (c²−a²=b²).' },
      { text: `${hyp} m`, misconception: 'Believed the height of the wall equals the length of the ladder, and did not use the Pythagorean Theorem.' },
      { text: `${hyp - base} m`, misconception: 'Simply subtracted the two lengths.' },
    ]);
    if (!options) return null;
    return {
      standard: GA_G, grade: 8, strand: 'G', kc: 'Pythagorean theorem — find a leg (ladder against a wall)',
      stem: `A ladder that has a length of ${hyp} m leans against a wall with the base of the ladder ${base} m away from the bottom of the wall. Use this information to find how high above the ground the ladder meets the wall.`,
      options, answer: correct, dok: 2, b: 0.2,
      figure: { type: 'ladder_wall', base, height, baseLabel: `${base} m`, heightLabel: 'x', hypLabel: `${hyp} m` },
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

// ---------------------------------------------------------------------------
// 4.GSR — grade-4 geometry: lines of symmetry, angle types, line relationships.
// Each carries a correct, labeled geometry2d / angle figure BY CONSTRUCTION.
// ---------------------------------------------------------------------------
const G4_GSR8 = '4.GSR.8';
const G4_GSR7 = '4.GSR.7';

const SYM_SHAPES: { shape: string; name: string; lines: number }[] = [
  { shape: 'square', name: 'square', lines: 4 },
  { shape: 'rectangle', name: 'rectangle', lines: 2 },
  { shape: 'rhombus', name: 'rhombus', lines: 2 },
  { shape: 'triangle_equilateral', name: 'equilateral triangle', lines: 3 },
  { shape: 'triangle_isosceles', name: 'isosceles triangle', lines: 1 },
  { shape: 'trapezoid', name: 'isosceles trapezoid', lines: 1 },
  { shape: 'pentagon', name: 'regular pentagon', lines: 5 },
  { shape: 'hexagon', name: 'regular hexagon', lines: 6 },
  { shape: 'octagon', name: 'regular octagon', lines: 8 },
  { shape: 'parallelogram', name: 'parallelogram', lines: 0 },
];

const symmetryCount: ItemModel = {
  id: 'symmetry-count', standard: G4_GSR8, grade: 4, strand: 'G',
  generate(rng) {
    const s = rng.pick(SYM_SHAPES);
    const correct = `${s.lines}`;
    const cand: [number, string][] = [
      [s.lines + 1, 'Counted one extra line of symmetry'],
      [Math.max(0, s.lines - 1), 'Missed a line of symmetry'],
      [s.lines + 2, 'Overcounted the lines of symmetry'],
      [s.lines === 0 ? 1 : 0, s.lines === 0 ? 'Assumed every shape has at least one line' : 'Assumed the shape has none'],
      // Fourth fallback so a 0-symmetry shape (parallelogram) still yields 3 distinct
      // distractors; without it {1,2} collapse to two and the item never generated.
      [s.lines + 3, 'Badly overcounted the lines of symmetry'],
    ];
    const ds: { text: string; misconception: string }[] = [];
    for (const [n, mc] of cand) {
      if (n !== s.lines && !ds.some((d) => d.text === `${n}`)) ds.push({ text: `${n}`, misconception: mc });
      if (ds.length === 3) break;
    }
    if (ds.length < 3) return null;
    const options = buildOptions(rng, correct, ds);
    if (!options) return null;
    return {
      standard: G4_GSR8, grade: 4, strand: 'G', kc: 'Lines of symmetry',
      stem: `How many lines of symmetry does the ${s.name} shown have?`,
      options, answer: correct, dok: 1, b: -0.5,
      figure: { type: 'geometry2d', shape: s.shape, symmetry: true },
    };
  },
};

const ANGLE_DEGS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
const angleType: ItemModel = {
  id: 'angle-type', standard: G4_GSR7, grade: 4, strand: 'G',
  generate(rng) {
    const deg = rng.pick(ANGLE_DEGS);
    const type = deg < 90 ? 'Acute' : deg === 90 ? 'Right' : 'Obtuse';
    const correct = `${type} angle`;
    const ds = ['Acute angle', 'Right angle', 'Obtuse angle', 'Straight angle']
      .filter((t) => t !== correct)
      .map((t) => ({ text: t, misconception: `Misclassified a ${correct.toLowerCase()} as ${t.toLowerCase()}` }));
    const options = buildOptions(rng, correct, ds);
    if (!options) return null;
    return {
      standard: G4_GSR7, grade: 4, strand: 'G', kc: 'Classify angles',
      stem: `The angle shown measures ${deg}°. What type of angle is it?`,
      options, answer: correct, dok: 1, b: -0.6,
      figure: { type: 'angle', degrees: deg, label: `${deg}°` },
    };
  },
};

const LINE_RELS: { shape: string; name: string }[] = [
  { shape: 'parallel_lines', name: 'Parallel' },
  { shape: 'perpendicular_lines', name: 'Perpendicular' },
  { shape: 'intersecting_lines', name: 'Intersecting' },
];
const lineRelationship: ItemModel = {
  id: 'line-relationship', standard: G4_GSR8, grade: 4, strand: 'G',
  generate(rng) {
    const r = rng.pick(LINE_RELS);
    const correct = r.name;
    const ds = LINE_RELS.filter((x) => x.name !== r.name)
      .map((x) => ({ text: x.name, misconception: `Confused ${r.name.toLowerCase()} with ${x.name.toLowerCase()} lines` }));
    ds.push({ text: 'Curved', misconception: 'Did not recognize the lines as straight' });
    const options = buildOptions(rng, correct, ds.slice(0, 3));
    if (!options) return null;
    return {
      standard: G4_GSR8, grade: 4, strand: 'G', kc: 'Parallel & perpendicular lines',
      stem: 'What best describes the pair of lines shown?',
      options, answer: correct, dok: 1, b: -0.4,
      figure: { type: 'geometry2d', shape: r.shape },
    };
  },
};

// ---------------------------------------------------------------------------
// 5.GSR.8 — grade-5 geometry: the coordinate plane (first quadrant). Name and
// locate ordered pairs, and measure distance along a grid line. Each item plots
// its point(s) on a real grid BY CONSTRUCTION, so a grade-5 coordinate item is
// never figure-less — the exact gap that made the imported "ordered pair for
// point K" items unanswerable.
// ---------------------------------------------------------------------------
const G5_GSR8 = '5.GSR.8';

/** A first-quadrant point with positive, UNEQUAL coordinates, so its reversal
 *  (y, x) is always a distinct, plausible distractor. */
function firstQuadrantPoint(rng: Rng, lo = 1, hi = 8): Pt {
  const x = rng.int(lo, hi);
  let y = rng.int(lo, hi);
  if (y === x) y = x < hi ? x + 1 : x - 1;
  return { x, y };
}

// Read the ordered pair of a single plotted, lettered point.
const readOrderedPair: ItemModel = {
  id: 'read-ordered-pair', standard: G5_GSR8, grade: 5, strand: 'G',
  generate(rng) {
    const label = rng.pick(['P', 'K', 'S', 'M', 'T', 'R'] as const);
    const pt = firstQuadrantPoint(rng);
    const correct = P(pt);
    const options = buildOptions(rng, correct, [
      { text: P({ x: pt.y, y: pt.x }), misconception: 'Reversed the coordinates — read the y-value before the x-value' },
      { text: P({ x: 0, y: pt.y }), misconception: 'Read only the vertical distance and used 0 for x' },
      { text: P({ x: pt.x, y: 0 }), misconception: 'Read only the horizontal distance and used 0 for y' },
    ]);
    if (!options) return null;
    return {
      standard: G5_GSR8, grade: 5, strand: 'G', kc: 'Name the ordered pair of a point',
      stem: `What ordered pair gives the location of point ${label} on the coordinate grid?`,
      options, answer: correct, dok: 1, b: -0.6,
      figure: { type: 'coordinate_grid', min: 0, max: Math.max(pt.x, pt.y) + 1, points: [{ x: pt.x, y: pt.y, label }] },
    };
  },
};

// Locate a point: which lettered point sits at the given ordered pair?
const identifyPointAt: ItemModel = {
  id: 'identify-point-at', standard: G5_GSR8, grade: 5, strand: 'G',
  generate(rng) {
    const target = firstQuadrantPoint(rng);
    const reversed: Pt = { x: target.y, y: target.x };
    const used = new Set([`${target.x},${target.y}`, `${reversed.x},${reversed.y}`]);
    const extras: Pt[] = [];
    let guard = 0;
    while (extras.length < 2 && guard++ < 40) {
      const p = firstQuadrantPoint(rng);
      const k = `${p.x},${p.y}`;
      if (!used.has(k)) { used.add(k); extras.push(p); }
    }
    if (extras.length < 2) return null;
    const labels = ['K', 'L', 'M', 'N'];
    const placed = rng
      .shuffle([
        { p: target, role: 'correct' as const },
        { p: reversed, role: 'reversed' as const },
        { p: extras[0], role: 'other' as const },
        { p: extras[1], role: 'other' as const },
      ])
      .map((e, i) => ({ ...e, label: labels[i] }));
    const correctLabel = placed.find((e) => e.role === 'correct')!.label;
    const distractors = placed
      .filter((e) => e.role !== 'correct')
      .map((e) => ({
        text: e.label,
        misconception: e.role === 'reversed' ? 'Reversed the coordinates — located (y, x) instead of (x, y)' : 'Selected a point at the wrong location',
      }));
    const options = buildOptions(rng, correctLabel, distractors);
    if (!options) return null;
    const hi = Math.max(...placed.flatMap((e) => [e.p.x, e.p.y]));
    return {
      standard: G5_GSR8, grade: 5, strand: 'G', kc: 'Locate a point from its ordered pair',
      stem: `Which point on the coordinate grid is located at ${P(target)}?`,
      options, answer: correctLabel, dok: 2, b: -0.3,
      figure: { type: 'coordinate_grid', min: 0, max: hi + 1, points: placed.map((e) => ({ x: e.p.x, y: e.p.y, label: e.label })) },
    };
  },
};

// Distance between two points on a horizontal or vertical grid line (first quadrant).
const coordinateDistanceLine: ItemModel = {
  id: 'coordinate-distance-line', standard: G5_GSR8, grade: 5, strand: 'G',
  generate(rng) {
    const vertical = rng.bool();
    const A = firstQuadrantPoint(rng, 1, 5);
    const d = rng.int(2, 5);
    const B: Pt = vertical ? { x: A.x, y: A.y + d } : { x: A.x + d, y: A.y };
    const correct = `${d} units`;
    const sum = A.x + A.y + B.x + B.y;
    const options = buildOptions(rng, correct, [
      { text: `${d + 1} units`, misconception: 'Counted the grid lines instead of the spaces between them' },
      { text: `${sum} units`, misconception: 'Added all the coordinates instead of subtracting' },
      { text: `${Math.max(1, d - 1)} units`, misconception: 'Counting error — came up one space short' },
    ]);
    if (!options) return null;
    const hi = Math.max(A.x, A.y, B.x, B.y);
    return {
      standard: G5_GSR8, grade: 5, strand: 'G', kc: 'Distance between two points on a grid line',
      stem: 'Points A and B are shown on the coordinate grid. How many units apart are they?',
      options, answer: correct, dok: 2, b: 0,
      figure: { type: 'coordinate_grid', min: 0, max: hi + 1, points: [{ x: A.x, y: A.y, label: 'A' }, { x: B.x, y: B.y, label: 'B' }] },
    };
  },
};


export const ITEM_MODELS: ItemModel[] = [
  reflectAcrossAxis,
  rotateAboutOrigin,
  translatePolygon,
  distanceCoordinate,
  pythagoreanHypotenuse,
  ladderPythagorean,
  volumeCylinder,
  volumeCone,
  volumeSphere,
  distanceNumberLine,
  symmetryCount,
  angleType,
  lineRelationship,
  readOrderedPair,
  identifyPointAt,
  coordinateDistanceLine,
];

export function modelsFor(grade: number, strand?: string): ItemModel[] {
  return ITEM_MODELS.filter((m) => m.grade === grade && (!strand || strand === 'all' || m.strand === strand));
}
