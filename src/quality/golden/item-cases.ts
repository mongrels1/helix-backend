/**
 * Golden cases for the question judge (`item-generation/item-judge.ts`), the
 * single verdict used by generation, import, Validate-All and the Verify
 * Database (integrity) page.
 *
 * Sources:
 *  - 'test 2026-11-01': errors planted on 1 Nov 2026 to test what the judge
 *    really catches (see project doc EdKairos_Integrity_Checks_Tested_2026-11-01).
 *  - commit hashes: the production failure each summer fix was written for.
 *  - 'live 2026-09-03': seen on the live practice page.
 *
 * `known` reflects measured behaviour on backend 30010c6. Do not edit it by
 * hand to make the suite pass: change it only when a check genuinely changes.
 */
import type { GoldenCase } from './golden.types';
import type { RawItem, Bank } from '../../intelligence/item-generation/item-judge';

export interface ItemInput { item: RawItem; bank: Bank }

/** Four options, exactly one correct; distractors tagged so structure is clean. */
function mc(texts: string[], correctIndex: number) {
  return texts.map((text, i) => ({ text, correct: i === correctIndex, misconceptionTag: i === correctIndex ? '' : 'distractor' }));
}

function practice(stem: string, options: string[], correctIndex: number, figure?: unknown, standard = 'MGSE7.G.4'): ItemInput {
  return {
    bank: 'practice',
    item: { stem, options: mc(options, correctIndex), answer: options[correctIndex], solution: 'Step 1. Worked solution.', standard, figure },
  };
}

export const ITEM_CASES: GoldenCase<ItemInput>[] = [
  // ---- controls: correct items must stay clean (no false alarms) ----------
  {
    id: 'control-circle-area', source: 'test 2026-11-01', expect: 'clean', known: 'caught',
    description: 'Correct circle-area item with a matching figure is served',
    input: practice('A circle has a radius of 5 cm. What is its area? Use 3.14.', ['78.5 cm²', '31.4 cm²', '15.7 cm²', '25 cm²'], 0,
      { type: 'circle', r: 5, show: 'radius', label: '5 cm' }),
  },
  {
    id: 'control-rect-area', source: 'test 2026-11-01', expect: 'clean', known: 'caught',
    description: 'Correct rectangle-area item with a matching figure is served',
    input: practice('A rectangle has a length of 8 cm and a width of 3 cm. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 0,
      { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' }),
  },
  {
    id: 'control-table-proportional', source: '1c07396', expect: 'clean', known: 'caught',
    description: 'Correct continue-the-table item is served',
    input: practice('Based on the pattern in the table, how many cups are needed after 6 batches?', ['24', '22', '20', '18'], 0,
      { type: 'function_table', headers: ['Batches', 'Cups'], rows: [{ in: 1, out: 4 }, { in: 2, out: 8 }, { in: 3, out: 12 }] }, 'MGSE6.RP.3'),
  },
  {
    id: 'false-alarm-vertical-angles-algebra', source: 'test 2026-11-01', expect: 'clean', known: 'gap',
    description: 'FALSE ALARM: correct item "(2x + 10)° and 100° are vertical, find x" (x = 45) is rejected; the angle re-solver expects 100',
    input: practice('Two vertical angles measure (2x + 10)° and 100°. What is the value of x?', ['45', '55', '35', '40'], 0, undefined, 'MGSE7.G.5'),
  },
  {
    id: 'control-vertical-angles-equation', source: 'a65d989', expect: 'clean', known: 'caught',
    description: 'Vertical-angle "which equation" item with the answer x = 45 is not wrongly rejected',
    input: practice('Two vertical angles are formed. One measures 45°. Which equation can be solved to find x, the measure of the other angle?', ['x = 45', 'x + 45 = 180', 'x + 45 = 90', '2x = 45'], 0, undefined, 'MGSE7.G.5'),
  },

  // ---- summer fixes: these must stay caught (regression guards) ----------
  {
    id: 'summer-table-miskeyed', source: '1c07396', expect: 'blocked', known: 'caught',
    description: 'Table pattern gives 24 but the key says 22',
    input: practice('Based on the pattern in the table, how many cups are needed after 6 batches?', ['24', '22', '20', '18'], 1,
      { type: 'function_table', headers: ['Batches', 'Cups'], rows: [{ in: 1, out: 4 }, { in: 2, out: 8 }, { in: 3, out: 12 }] }, 'MGSE6.RP.3'),
  },
  {
    id: 'summer-ratio-miskeyed', source: 'f889a5a', expect: 'blocked', known: 'caught',
    description: 'Adults:children 3:5 with 120 children should be 72 adults; key says 60',
    input: practice('The ratio of adults to children at a park is 3:5. There are 120 children. How many adults are there?', ['72', '60', '200', '45'], 1, undefined, 'MGSE6.RP.3'),
  },
  {
    id: 'summer-coord-label-reveals-answer', source: '1c07396', expect: 'blocked', known: 'caught',
    description: 'Point is labelled with its own coordinates on a "name the ordered pair" item',
    input: practice('What ordered pair names the location of point A?', ['(3, 4)', '(4, 3)', '(3, 3)', '(4, 4)'], 0,
      { type: 'coordinate_grid', min: 0, max: 10, points: [{ x: 3, y: 4, label: '(3, 4)' }] }, 'MGSE5.G.2'),
  },
  {
    id: 'summer-grade5-negative-coords', source: '1c07396', expect: 'blocked', known: 'caught',
    description: 'Grade-5 coordinate figure uses negative coordinates',
    input: practice('Point B is plotted on the grid. How far is point B from the y-axis?', ['3 units', '2 units', '5 units', '1 unit'], 0,
      { type: 'coordinate_grid', min: -5, max: 5, points: [{ x: -3, y: 2, label: 'B' }] }, 'MGSE5.G.2'),
  },
  {
    id: 'summer-options-name-missing-points', source: '1c07396', expect: 'blocked', known: 'caught',
    description: 'Answer choices name points that are not on the graph',
    input: practice('Which point is located at (2, 5)?', ['Point K', 'Point L', 'Point M', 'Point N'], 0,
      { type: 'coordinate_grid', min: 0, max: 10, points: [{ x: 2, y: 5, label: 'A' }, { x: 5, y: 2, label: 'B' }] }, 'MGSE5.G.2'),
  },
  {
    id: 'summer-concentric-one-circle', source: 'item-resolver figureCompleteness', expect: 'blocked', known: 'caught',
    description: 'Question describes two concentric circles but one circle is drawn',
    input: practice('Two concentric circles have radii 3 cm and 5 cm. What is the area of the ring between them? Use 3.14.', ['50.24 cm²', '78.5 cm²', '28.26 cm²', '6.28 cm²'], 0,
      { type: 'circle', r: 5, show: 'radius', label: '5 cm' }),
  },
  {
    id: 'summer-composite-single-shape', source: 'item-resolver figureCompleteness', expect: 'blocked', known: 'caught',
    description: 'Composite figure (rectangle and a semicircle) drawn as a single rectangle',
    input: practice('A figure is composed of a rectangle 6 cm by 4 cm and a semicircle attached on one side. What is its area?', ['30.28 cm²', '24 cm²', '36.56 cm²', '12.56 cm²'], 0,
      { type: 'rect', w: 6, h: 4, unit: 'cm', mode: 'area' }),
  },
  {
    id: 'summer-pyramid-flat-square', source: 'item-resolver figureCompleteness', expect: 'blocked', known: 'caught',
    description: 'Question shows a square pyramid but a flat square is drawn',
    input: practice('The diagram shows a right square pyramid with base edges of 6 cm. How many faces does it have?', ['5', '4', '6', '8'], 0,
      { type: 'rect', w: 6, h: 6, unit: 'cm', mode: 'plain' }, 'MGSE7.G.3'),
  },
  {
    id: 'live-figure-referenced-missing', source: 'live 2026-09-03', expect: 'blocked', known: 'caught',
    description: '"Use the figure" but no figure is attached (Triangle PQR, live practice page)',
    input: practice('Triangle PQR is similar to triangle STU. Use the figure to find the length of PQ.', ['6', '8', '10', '12'], 1, undefined, 'MGSE8.G.4'),
  },
  {
    id: 'summer-duplicate-options', source: '2d3929f', expect: 'blocked', known: 'caught',
    description: 'Two answer choices are identical',
    input: practice('A rectangle has a length of 8 cm and a width of 3 cm. What is its area?', ['24 cm²', '24 cm²', '11 cm²', '12 cm²'], 0,
      { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' }),
  },

  // ---- test 2026-11-01: figure VALUES are not compared to the question ----
  {
    id: 'fig-circle-label-mismatch', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Circle drawn with radius 5 but labelled "14 in"',
    input: practice('A circle has a radius of 5 cm. What is its area? Use 3.14.', ['78.5 cm²', '31.4 cm²', '15.7 cm²', '25 cm²'], 0,
      { type: 'circle', r: 5, show: 'radius', label: '14 in' }),
  },
  {
    id: 'fig-right-triangle-bad-hypotenuse', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Hypotenuse labelled 12 cm for legs 6 cm and 8 cm (should be 10)',
    input: practice('A right triangle has legs 6 cm and 8 cm. How long is the hypotenuse?', ['10 cm', '14 cm', '12 cm', '48 cm'], 0,
      { type: 'right_triangle', a: 6, b: 8, labelA: '6 cm', labelB: '8 cm', labelC: '12 cm' }, 'MGSE8.G.7'),
  },
  {
    id: 'fig-line-wrong-equation', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Line drawn as y = 2x + 1 but the question says y = 3x',
    input: practice('The graph shows the line y = 3x. What is the slope?', ['3', '2', '1', '0'], 0,
      { type: 'coordinate_grid', min: -5, max: 5, points: [{ x: 1, y: 3 }], line: { m: 2, b: 1 } }, 'MGSE8.EE.5'),
  },
  {
    id: 'fig-points-off-line', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Plotted points do not lie on the stated line y = 2x',
    input: practice('The points on the graph lie on y = 2x. What is y when x = 2?', ['4', '2', '6', '8'], 0,
      { type: 'coordinate_grid', min: 0, max: 10, points: [{ x: 1, y: 2 }, { x: 2, y: 5 }, { x: 3, y: 9 }] }, 'MGSE8.EE.5'),
  },
  {
    id: 'fig-ratio-table-breaks-rate', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Table breaks the stated rate of $2 per apple (3 apples → $7)',
    input: practice('Apples cost $2 each. The table shows the cost. How much do 5 apples cost?', ['$10', '$7', '$12', '$5'], 0,
      { type: 'ratio_table', headers: ['Apples', 'Cost ($)'], rows: [{ a: 1, b: 2 }, { a: 3, b: 7 }, { a: 4, b: 9 }] }, 'MGSE6.RP.3'),
  },
  {
    id: 'fig-bar-graph-contradicts-text', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Bar graph shows 15 for Sam but the question says 12',
    input: practice('Sam read 12 books and Ana read 9 books, as shown in the bar graph. How many more books did Sam read?', ['3', '21', '6', '12'], 0,
      { type: 'bar_graph', bars: [{ label: 'Sam', value: 15 }, { label: 'Ana', value: 9 }] }, 'MGSE3.MD.3'),
  },
  {
    id: 'fig-rect-wrong-dimensions', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Rectangle drawn 6 by 4 but the question says 8 by 3 (warning only today)',
    input: practice('A rectangle is 8 cm long and 3 cm wide. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 0,
      { type: 'rect', w: 6, h: 4, unit: 'cm', mode: 'area' }),
  },
  {
    id: 'fig-geogebra-wrong-function', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'GeoGebra graph of y = 2x + 1 for a question about y = 3x − 2',
    input: practice('The graph shows y = 3x - 2. What is the y-intercept?', ['-2', '3', '2', '-3'], 0,
      { type: 'geogebra', appName: 'graphing', commands: ['f(x)=2x+1'] }, 'MGSE8.F.4'),
  },
  {
    id: 'fig-angle-label-mismatch', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Angle drawn as 60° but labelled 45°',
    input: practice('The angle shown measures 45°. What is its complement?', ['45°', '135°', '35°', '55°'], 0,
      { type: 'angle', degrees: 60, label: '45°' }, 'MGSE7.G.5'),
  },
  {
    id: 'fig-triangle-wrong-dimensions', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Triangle drawn base 10 height 3 but the question says base 8 height 5 (warning only today)',
    input: practice('A triangle has a base of 8 cm and a height of 5 cm. What is its area?', ['20 cm²', '40 cm²', '13 cm²', '30 cm²'], 0,
      { type: 'triangle', base: 10, height: 3, unit: 'cm', mode: 'area' }, 'MGSE6.G.1'),
  },

  // ---- test 2026-11-01: wrong answer keys the re-solver cannot read --------
  {
    id: 'key-rect-long-wide-phrasing', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Wrong key (22) for "8 cm long and 3 cm wide" (caught only when worded "length of … width of")',
    input: practice('A rectangle is 8 cm long and 3 cm wide. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 1,
      { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' }),
  },
  {
    id: 'key-rect-by-with-units', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Wrong key (22) for "8 cm by 3 cm"',
    input: practice('A rectangle is 8 cm by 3 cm. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 1,
      { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' }),
  },
  {
    id: 'key-rect-times-sign', source: 'test 2026-11-01', expect: 'blocked', known: 'gap',
    description: 'Wrong key (22) for "a garden measures 8 m × 3 m"',
    input: practice('A rectangular garden measures 8 m × 3 m. Find the area.', ['24 m²', '22 m²', '11 m²', '12 m²'], 1,
      { type: 'rect', w: 8, h: 3, unit: 'm', mode: 'area' }),
  },
  {
    id: 'key-rect-length-width-phrasing', source: 'test 2026-11-01', expect: 'blocked', known: 'caught',
    description: 'Wrong key (22) for "a length of 8 cm and a width of 3 cm" (this wording is caught)',
    input: practice('A rectangle has a length of 8 cm and a width of 3 cm. What is its area?', ['24 cm²', '22 cm²', '11 cm²', '12 cm²'], 1,
      { type: 'rect', w: 8, h: 3, unit: 'cm', mode: 'area' }),
  },
];
