/**
 * Golden cases for the Lesson Plan Maker's checks (`lesson-plan/lesson-plan.quality.ts`).
 *
 * Every error below was hand-fixed in a real plan before printing. The model's
 * original drafts were not kept, so each case is REBUILT from the review doc
 * that recorded it (named in `source`), using that week's correct upload
 * figures as the source text. The wording is a faithful reconstruction, not
 * the verbatim draft.
 *
 * How a case is judged (see scorecard.ts):
 *  - practice / worked: run through normaliseClassDay with the week's source
 *    numbers; 'blocked' = the item was removed or replaced.
 *  - lesson_text: checkUnitFacts + inventedFigures; 'blocked' = flagged.
 */
import type { GoldenCase } from './golden.types';

export type LessonPlanInput =
  | { kind: 'practice'; problem: string; answer: string; sourceText: string }
  | { kind: 'worked'; problem: string; solution: string; sourceText: string }
  | { kind: 'lesson_text'; text: string; sourceText: string };

/** Correct figures from each week's uploads, as recorded in the review docs. */
const NOV9 = 'Oatmeal 76 gallons per 4 ounces. Table 2 38, 4 76, 10 ?, ? 304. Answers 190 and 16. 16 ounces = 1 pound. ' +
  'Ounces 1/2 2 4 16, Pounds 1/8 1/4. Meal Plan Q7 2,080 gallons. 480 pesos, $21, 10.5 pints, $14.50, $10.40, 5 in, 210 s.';
const NOV16 = 'Lin 1 0.11, 2 0.21, 4 0.41, 5 0.53 miles per minute. Elena 7.5 mph. Turtles Lane 1 1 ft/s with a 6 ft head start, ' +
  'Lane 2 3 ft/s, Lane 3 1.5 ft/s, Lane 4 d = 2t. Water $1.25 per m3, private $5, $200 buys 160 and 40. Diagnostic table 0 2 4 5 -> 0 4 8 10; graph y = 4x. ' +
  'Garden 10 m drawn 20 cm, pond radius 1.5 m. Gravel 15 m path 1 m wide 0.08 m deep $40.';
const NOV30 = 'Wages (1,15) (10,150) $15/h, 40 h $600. Plumber W = 20h $800. Machinist $18.50/h. Option B (100,2) (200,4) (300,6) 0.02. ' +
  'Tigris y = 8x, Jordan 2 in/yr, 96 vs 24, 160 in. South $0.0051/gal, north $0.00935/gal, 15,000 gal $76.50 $140.25 $63.75. ' +
  'Salt 0.34 0.02, 1,000 gal 340 20, 5,000 gal 1,700 100. Triangles ABC 3 4, CDE 6 8, FGH 1.5 2. Lines A 3/2, B 1/3, C 1, D 2, E 0.25. ' +
  'Recipe 1 1:4, Recipe 2 graph (10,50) (20,100) (30,150), 16 cups, jug 80 cups.';

export const LESSON_PLAN_CASES: GoldenCase<LessonPlanInput>[] = [
  // ---- controls: correct content must survive ------------------------------
  {
    id: 'lp-control-correct-practice', source: 'LP12 (FILLED_8 correct items)', expect: 'clean', known: 'caught',
    description: 'Correct practice from the uploads (76 ÷ 4 = 19 gallons per ounce) is kept',
    input: { kind: 'practice', problem: 'Oatmeal uses 76 gallons of water for 4 ounces. How many gallons per ounce?', answer: '76 ÷ 4 = 19 gallons per ounce', sourceText: NOV9 },
  },
  {
    id: 'lp-control-scale-with-keyword', source: 'LP14', expect: 'clean', known: 'caught',
    description: 'A scale written on a plan ("2 cm = 1 m on the garden plan") is not called a wrong unit fact',
    input: { kind: 'lesson_text', text: 'On the garden plan the scale is 2 cm = 1 m, so the 10 m garden is drawn 20 cm long.', sourceText: NOV16 },
  },
  {
    id: 'lp-false-alarm-scale-no-keyword', source: 'LP16 follow-ups', expect: 'clean', known: 'gap',
    description: 'FALSE ALARM: "1 cm = 0.5 m" (a scale) is flagged as a wrong unit fact when no scale word is nearby',
    input: { kind: 'lesson_text', text: 'Thursday: 1 cm = 0.5 m, so the pond radius of 1.5 m is 3 cm.', sourceText: NOV16 },
  },

  // ---- caught today (regression guards) ------------------------------------
  {
    id: 'lp-arithmetic-slip', source: 'LP4/LP5 answer check', expect: 'blocked', known: 'caught',
    description: 'Practice answer with an arithmetic slip (76 ÷ 4 = 18) is removed',
    input: { kind: 'practice', problem: 'Oatmeal uses 76 gallons of water for 4 ounces. How many gallons per ounce?', answer: '76 ÷ 4 = 18 gallons per ounce', sourceText: NOV9 },
  },
  {
    id: 'lp-two-ounces-one-pound', source: 'LP12 (FILLED_8 Tue lesson text)', expect: 'blocked', known: 'caught',
    description: '"2 ounces = 1 pound" in the lesson text is flagged',
    input: { kind: 'lesson_text', text: 'Remind students that 2 ounces = 1 pound before they complete the table.', sourceText: NOV9 },
  },
  {
    id: 'lp-invented-food-guide-practice', source: 'LP12 (FILLED_8 practice)', expect: 'blocked', known: 'caught',
    description: 'Practice built on an invented Food Guide figure (1,040 gallons per serving) is removed',
    input: { kind: 'practice', problem: 'Beef uses 1,040 gallons per serving. How many gallons for 3 servings?', answer: '1,040 × 3 = 3,120 gallons', sourceText: NOV9 },
  },
  {
    id: 'lp-invented-figure-lesson-text', source: 'LP12b (FILLED_8 lesson text)', expect: 'blocked', known: 'caught',
    description: 'Invented figure 1,430 gallons in the lesson text is flagged',
    input: { kind: 'lesson_text', text: 'Show the class that a burger meal uses about 1,430 gallons of water.', sourceText: NOV9 },
  },
  {
    id: 'lp-wrong-worksheet-figure', source: 'LP13 (FILLED_9 Thu lesson)', expect: 'blocked', known: 'caught',
    description: 'Lesson says 2,280 gallons where worksheet Meal Plan Q7 says 2,080',
    input: { kind: 'lesson_text', text: 'For Meal Plan question 7, the meal uses 2,280 gallons in total.', sourceText: NOV9 },
  },
  {
    id: 'lp-think-aloud-wait', source: 'LP14 (FILLED_11 turtles q5)', expect: 'blocked', known: 'caught',
    description: 'Answer that thinks aloud ("Lane 1 is faster. Wait—") is removed',
    input: { kind: 'practice', problem: 'Which turtle is faster, Lane 1 or Lane 3?', answer: 'Lane 1 is faster. Wait—Lane 3 is faster at 1.5 ft/s.', sourceText: NOV16 },
  },

  // ---- gaps: hand-fixed errors the checks do not catch ---------------------
  {
    id: 'lp-think-aloud-actually', source: 'LP16 (FILLED_12 Mon practice 1)', expect: 'blocked', known: 'gap',
    description: 'Answer that thinks aloud with "Actually," is printed',
    input: { kind: 'practice', problem: 'Which turtle is faster, Lane 1 or Lane 3?', answer: 'Lane 1 is faster because it starts ahead. Actually, Lane 3 is faster: 1.5 ft/s vs 1 ft/s.', sourceText: NOV16 },
  },
  {
    id: 'lp-invented-small-figures', source: 'LP13 (FILLED_9 lesson text)', expect: 'blocked', known: 'gap',
    description: 'Invented Food Guide stand-ins under 100 (brown rice 0.3 gallons per ounce) are not flagged',
    input: { kind: 'lesson_text', text: 'Provide the Food Guide data, for example brown rice: 0.3 gallons per ounce.', sourceText: NOV9 },
  },
  {
    id: 'lp-invented-differentiation-example', source: 'LP13 (FILLED_9 differentiation)', expect: 'blocked', known: 'gap',
    description: 'Invented example "Brown rice: 2 oz, 50 gallons per serving, w = 25s" is not flagged',
    input: { kind: 'lesson_text', text: 'Differentiation: Brown rice: 2 oz, 50 gallons per serving, w = 25s.', sourceText: NOV9 },
  },
  {
    id: 'lp-invented-rate-table', source: 'LP14 (FILLED_11 formative)', expect: 'blocked', known: 'gap',
    description: "Invented table for Lin (0.15 miles per minute) instead of the picture's 0.11 / 0.21 / 0.41 / 0.53",
    input: { kind: 'practice', problem: 'Lin runs 0.15 miles per minute. How long does 1 mile take?', answer: '1 ÷ 0.15 ≈ 6.7 minutes', sourceText: NOV16 },
  },
  {
    id: 'lp-wrong-method-single-point', source: 'LP16 (FILLED_12 Tue practice 1)', expect: 'blocked', known: 'gap',
    description: "Lin's rate taken from one table row (0.11, ≈9.1 min) instead of the whole table (≈0.106, ≈9.4 min)",
    input: { kind: 'practice', problem: "Use Lin's table to find how long 1 mile takes.", answer: '1 ÷ 0.11 ≈ 9.1 minutes', sourceText: NOV16 },
  },
  {
    id: 'lp-wrong-comparison', source: 'LP16 (FILLED_12 Wed practice 2)', expect: 'blocked', known: 'gap',
    description: 'Lane 4 (d = 2t, 2 ft/s) called faster than Lane 2 (3 ft/s)',
    input: { kind: 'practice', problem: 'Lane 4 follows d = 2t. Compare it with Lane 2.', answer: 'Lane 4 is faster than Lane 2 (3 ft/s).', sourceText: NOV16 },
  },
  {
    id: 'lp-student-flawed-work-as-fact', source: 'LP16 (FILLED_12 Fri worked example)', expect: 'blocked', known: 'gap',
    description: 'Hina\'s handwritten "1:2" taken as the scale (1 cm per 2 m); the real scale is 2 cm = 1 m',
    input: { kind: 'worked', problem: 'The shed is 4 m by 6.5 m. Draw it to the plan scale.', solution: 'Scale 1:2 means 1 cm per 2 m, so 4 ÷ 2 = 2 cm and 6.5 ÷ 2 = 3.25 cm.', sourceText: NOV16 },
  },
  {
    id: 'lp-wrong-scale-pond', source: 'LP16 (FILLED_12 Fri practice 1)', expect: 'blocked', known: 'gap',
    description: 'Pond drawn 0.75 cm on the plan; at 2 cm = 1 m the 1.5 m radius is 3 cm',
    input: { kind: 'practice', problem: 'The pond has a radius of 1.5 m. How long is the radius on the plan?', answer: '1.5 ÷ 2 = 0.75 cm', sourceText: NOV16 },
  },
  {
    id: 'lp-wrong-scale-decking', source: 'LP14 (FILLED_11 Thu/Fri)', expect: 'blocked', known: 'caught',
    description: 'Decking worked at 1 cm : 2 m ("2 cm × 1.5 cm = 4 m × 3 m"); flagged, but BY ACCIDENT as a wrong cm-to-m conversion, not as the wrong scale',
    input: { kind: 'lesson_text', text: 'At 1 cm : 2 m, the decking drawn 2 cm × 1.5 cm is 4 m × 3 m.', sourceText: NOV16 },
  },
  {
    id: 'lp-misread-table-equation', source: 'LP16 (FILLED_12 Mon lesson text)', expect: 'blocked', known: 'gap',
    description: '"All three representations show y = 4x" but the diagnostic table is y = 2x',
    input: { kind: 'lesson_text', text: 'Tuesday recap: all three representations show y = 4x, so they match.', sourceText: NOV16 },
  },
  {
    id: 'lp-misread-graph-slope', source: 'LP17 (Nov 30 Thu Tyler Recipe 2)', expect: 'blocked', known: 'gap',
    description: 'Recipe 2 graph misread as (20,130), slope 6.5, giving 104 cups; the graph is y = 5x, so 80 cups',
    // The picture reader misread the graph, so the generator's source text DID contain (20, 130).
    input: { kind: 'practice', problem: 'Recipe 2: the graph passes through (20, 130). How much water for 16 cups of disinfectant?', answer: '130 ÷ 20 = 6.5, and 16 × 6.5 = 104 cups', sourceText: `${NOV30} [picture on page 6, read from the image: Recipe 2 graph through (20, 130)]` },
  },
  {
    id: 'lp-wrong-recipe-choice', source: 'LP17 (Nov 30 Thu jug question)', expect: 'blocked', known: 'gap',
    description: 'Picks Recipe 1 "because 104 > 80"; both fit the jug and Recipe 2 fills it exactly',
    input: { kind: 'practice', problem: 'Which recipe should Tyler use for the 80-cup jug?', answer: 'Recipe 1, because 104 > 80.', sourceText: NOV30 },
  },
  {
    id: 'lp-misread-line-slopes', source: 'LP17 (Nov 30 Mon practice 2)', expect: 'blocked', known: 'gap',
    description: 'Line slopes misread from the picture (A = 2, C = 3/2, D = 1; correct A = 3/2, C = 1, D = 2)',
    input: { kind: 'practice', problem: 'Match each line on page 5 to its slope.', answer: 'A = 2, C = 3/2, D = 1', sourceText: NOV30 },
  },
  {
    id: 'lp-invented-triangle-sides', source: 'LP17 (Nov 30 Mon practice 1)', expect: 'blocked', known: 'gap',
    description: 'Invented slope triangles ABC 2 × 3 and CDE 4 × 6 (the figure shows 3/4, 6/8, 1.5/2)',
    input: { kind: 'practice', problem: 'Triangle ABC has a rise of 2 and a run of 3; CDE has a rise of 4 and a run of 6. Are the slopes equal?', answer: '2/3 = 4/6, so yes', sourceText: NOV30 },
  },
];
