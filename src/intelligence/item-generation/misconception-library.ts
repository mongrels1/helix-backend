/**
 * EdKairos — Misconception Library
 * ---------------------------------------------------------------------------
 * Canonical catalog of student misconceptions, harvested from the per-distractor
 * rationales in the Illuminate/Inspect MGSE6.RP item bank (48 items) and
 * generalized into reusable classes.
 *
 * WHY THIS EXISTS
 *  - DRIVES generation: the question engine builds every wrong answer from a
 *    real misconception in this catalog, not random noise. A distractor is a
 *    diagnosis, not a decoy.
 *  - POWERS diagnosis: when a student picks a distractor, we resolve it to a
 *    misconception id -> we know *why* they're wrong, not just *that* they are.
 *  - SURVIVES the seed: even when a purchased/seed bank is only used as
 *    reference (never added to the EdKairos bank), its pedagogical signal is
 *    captured here permanently.
 *
 * HOW IT'S USED
 *  - generator: for a target skill, look up applicableMisconceptions() -> emit
 *    one distractor per misconception with errorPattern as the construction rule.
 *  - tagging: GeneratedItem.options[].misconceptionTag references an id here.
 *  - analytics: aggregate misconception ids across responses -> remediation routing.
 *
 * SCOPE NOTE: families are domain-general; the seeded `examples` and the bulk of
 * the `standards` here are Grade-6 Ratios & Proportional Relationships, because
 * that is the bank we ingested. Add entries as new banks are ingested.
 */

export type MisconceptionFamily =
  | 'additive_vs_multiplicative'
  | 'operation_choice'
  | 'rate_setup'
  | 'part_whole_percent'
  | 'place_value_decimal'
  | 'equivalent_ratio_table'
  | 'data_interpretation'
  | 'reading_interpretation';

export interface Misconception {
  /** stable id — referenced by generated items and analytics. NEVER renumber. */
  id: string;
  /** short human label */
  label: string;
  family: MisconceptionFamily;
  /** standards where this misconception commonly surfaces (MGSE + GA cluster) */
  standards: string[];
  /** what the student believes / does wrong, in plain language */
  description: string;
  /**
   * DISTRACTOR CONSTRUCTION RULE. Deterministic recipe the generator follows to
   * build the wrong answer that this misconception produces. Written so a model
   * (or code) can apply it to fresh numbers.
   */
  errorPattern: string;
  /** what a student selecting this distractor reveals about their mastery */
  diagnosticSignal: string;
  /** real distractor(s) observed in the seed bank (provenance) */
  examples: { itemId: string; standard: string; distractor: string }[];
  /** suggested remediation hook (skill/representation to re-teach with) */
  remediation: string;
}

export const MISCONCEPTIONS: Misconception[] = [
  /* ---------------------------------------------------------------------------
   * FAMILY 1 — ADDITIVE vs MULTIPLICATIVE REASONING
   * The single most important RP misconception: treating a ratio relationship
   * additively (constant difference) instead of multiplicatively (constant rate).
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.ADD_INSTEAD_OF_SCALE',
    label: 'Adds a constant instead of scaling by the ratio',
    family: 'additive_vs_multiplicative',
    standards: ['MGSE6.RP.3', 'MGSE6.RP.3a', '6.NR.4'],
    description:
      'Student keeps the same difference between quantities instead of the same multiplicative rate when scaling a ratio up or down.',
    errorPattern:
      'Instead of multiplying both quantities by the scale factor k, add the original difference (b − a) to the given quantity.',
    diagnosticSignal:
      'Has not internalized that a ratio is a multiplicative (not additive) relationship — the core Grade-6 proportional-reasoning gap.',
    examples: [
      { itemId: '46499', standard: 'MGSE6.RP.3', distractor: 'This is the result of adding 38 and 20.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3d', distractor: 'This is the result of adding 22 and 3 then dividing.' },
    ],
    remediation: 'Re-teach with a double number line / ratio table so equal multiplicative jumps are visible.',
  },
  {
    id: 'RP.DIFFERENCE_NOT_RATIO',
    label: 'Compares by difference instead of ratio',
    family: 'additive_vs_multiplicative',
    standards: ['MGSE6.RP.1', '6.NR.4'],
    description:
      'Student compares two quantities by how much MORE one is (subtraction) rather than how many TIMES (ratio).',
    errorPattern:
      'Report the difference (larger − smaller) where the correct answer is the ratio (larger ÷ smaller) or a part-to-part ratio.',
    diagnosticSignal: 'Confuses absolute difference with relative (ratio) comparison.',
    examples: [
      { itemId: 'multi', standard: 'MGSE6.RP.1', distractor: 'This is the result of using a difference instead of a ratio.' },
      { itemId: '22683', standard: 'MGSE6.RP.1', distractor: 'This is the result of comparing Gary to Elena, 325 to ...' },
    ],
    remediation: 'Contrast "how many more" vs "how many times" on the same pair of numbers.',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 2 — OPERATION CHOICE
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.MULTIPLY_INSTEAD_OF_DIVIDE',
    label: 'Multiplies when the unit rate requires division',
    family: 'operation_choice',
    standards: ['MGSE6.RP.2', 'MGSE6.RP.3b', '6.NR.4'],
    description: 'To find a unit rate (per one), student multiplies the two quantities instead of dividing.',
    errorPattern: 'Return total × count (or the two quantities multiplied) where the key is total ÷ count.',
    diagnosticSignal: 'Does not connect "per one" / unit rate to division.',
    examples: [
      { itemId: '27003', standard: 'MGSE6.RP.3', distractor: 'This is the result of multiplying 15 and 70.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3b', distractor: 'This is the result of multiplying instead of dividing.' },
    ],
    remediation: 'Anchor "unit rate = split into equal groups of one" with a tape/ratio-table partition.',
  },
  {
    id: 'RP.SUBTRACT_INSTEAD_OF_DIVIDE',
    label: 'Subtracts when division is required',
    family: 'operation_choice',
    standards: ['MGSE6.RP.3b', 'MGSE6.RP.3d', '6.NR.4'],
    description: 'Student subtracts the two quantities instead of dividing to find a rate or quotient.',
    errorPattern: 'Return total − count where the key is total ÷ count.',
    diagnosticSignal: 'Defaults to subtraction; has not selected the operation from the problem structure.',
    examples: [
      { itemId: '81430', standard: 'MGSE6.RP.3b', distractor: 'Student(s) may have subtracted instead of dividing.' },
    ],
    remediation: 'Operation-sorting: which question words signal rate (÷) vs change (−).',
  },
  {
    id: 'RP.WRONG_OPERATION',
    label: 'Uses the wrong operation (generic)',
    family: 'operation_choice',
    standards: ['MGSE6.RP.3', 'MGSE6.RP.3b'],
    description: 'Student applies an operation unsupported by the problem (catch-all when not add/sub/mult specific).',
    errorPattern: 'Apply a plausible-but-wrong operation to the two salient numbers.',
    diagnosticSignal: 'Operation selection is not yet driven by problem structure.',
    examples: [
      { itemId: '81430', standard: 'MGSE6.RP.3b', distractor: 'Student(s) may have used the wrong operation.' },
    ],
    remediation: 'Model the situation before computing (draw it, then choose the operation).',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 3 — RATE SETUP / INVERSION
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.INVERTED_RATE',
    label: 'Inverts the rate (wrong quantity on top)',
    family: 'rate_setup',
    standards: ['MGSE6.RP.2', 'MGSE6.RP.3a', 'MGSE6.RP.3d', '6.NR.4'],
    description: 'Student divides in the wrong order — confuses divisor and dividend, producing the reciprocal rate.',
    errorPattern: 'Return count ÷ total (or B/A) where the key is total ÷ count (A/B); i.e. the reciprocal.',
    diagnosticSignal: 'Knows division is involved but has not fixed which quantity is "per one".',
    examples: [
      { itemId: '81430', standard: 'MGSE6.RP.3b', distractor: 'Student(s) may have confused the divisor and dividend.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3d', distractor: 'Student(s) may have reversed the order of the quantities.' },
      { itemId: '27963', standard: 'MGSE6.RP.3d', distractor: 'This is the result of setting up the proportion 1/3.28 ...' },
    ],
    remediation: 'Label both rates with units ("$ per pizza" vs "pizzas per $") before dividing.',
  },
  {
    id: 'RP.NO_UNIT_RATE',
    label: 'Does not reduce to a unit rate',
    family: 'rate_setup',
    standards: ['MGSE6.RP.2', 'MGSE6.RP.3b'],
    description: 'Student compares or scales without first finding the per-one value, so totals are not comparable.',
    errorPattern: 'Compare raw totals directly without dividing to a common unit rate.',
    diagnosticSignal: 'Missing the unit-rate strategy for comparing/scaling.',
    examples: [
      { itemId: 'multi', standard: 'MGSE6.RP.2', distractor: 'This is the result of not realizing that the unit rate ...' },
      { itemId: '61226', standard: 'MGSE6.RP.3b', distractor: 'Student(s) did not know how to calculate rate.' },
    ],
    remediation: 'Always find "the cost of one / the amount per one" as step zero.',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 4 — PART / WHOLE / PERCENT
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.PERCENT_COMPLEMENT',
    label: 'Finds the complement percent (100% − p)',
    family: 'part_whole_percent',
    standards: ['MGSE6.RP.3c', '6.NR.5'],
    description: 'Student solves for (100 − p)% instead of the asked p% (or vice-versa).',
    errorPattern: 'Compute (100 − p)% of the whole where the key is p% of the whole.',
    diagnosticSignal: 'Reads the percent but not which part (asked vs leftover) is wanted.',
    examples: [
      { itemId: '46499', standard: 'MGSE6.RP.3c', distractor: 'This is the result of finding 80% (100% – 20%) of 38.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3c', distractor: 'This is the result of finding 80% instead of finding 20%.' },
    ],
    remediation: 'Underline "of what" and "which part" before computing a percent.',
  },
  {
    id: 'RP.PART_FOR_WHOLE',
    label: 'Confuses part and whole in a percent problem',
    family: 'part_whole_percent',
    standards: ['MGSE6.RP.3c', '6.NR.5'],
    description: 'Student takes p% of the part, or treats the part as the whole, when finding the missing total.',
    errorPattern: 'Compute p% of the given number, or return the part, where the key requires part ÷ (p/100) = whole.',
    diagnosticSignal: 'Has not mapped the percent equation part = percent × whole onto the situation.',
    examples: [
      { itemId: '46499', standard: 'MGSE6.RP.3c', distractor: 'This is the result of finding what the total number is ...' },
      { itemId: 'multi', standard: 'MGSE6.RP.3c', distractor: 'This is the result of finding 40% of 60.' },
      { itemId: '259640', standard: 'MGSE6.RP.3c', distractor: 'This is the result of finding 32 percent of 16.' },
    ],
    remediation: 'Use a percent bar: mark the part, the percent, solve for the 100% whole.',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 5 — PLACE VALUE / DECIMAL / COMPUTATION
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.DECIMAL_PLACEMENT',
    label: 'Misplaces the decimal (off by a power of 10)',
    family: 'place_value_decimal',
    standards: ['MGSE6.RP.3b', 'MGSE6.RP.3d', '6.NR.3'],
    description: 'Student computes correctly but places the decimal point wrong, landing off by ×10 or ÷10.',
    errorPattern: 'Take the correct digits but shift the decimal one place (×10 or ÷10).',
    diagnosticSignal: 'Procedure intact; place-value/estimation check missing.',
    examples: [
      { itemId: 'multi', standard: 'MGSE6.RP.3b', distractor: 'Student(s) may have placed the decimal in the wrong place.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3d', distractor: 'Student(s) may have been off by a factor of 10.' },
    ],
    remediation: 'Estimate first ("about how big should the answer be?") to catch decimal slips.',
  },
  {
    id: 'RP.COMPUTATION_ERROR',
    label: 'Arithmetic/computation slip',
    family: 'place_value_decimal',
    standards: ['MGSE6.RP.2', 'MGSE6.RP.3a', 'MGSE6.RP.3b'],
    description: 'Correct method, wrong arithmetic (a division/multiplication slip).',
    errorPattern: 'Apply the correct operation but perturb the arithmetic result by a small, plausible amount.',
    diagnosticSignal: 'Conceptual understanding likely intact; fluency/accuracy lapse.',
    examples: [
      { itemId: 'multi', standard: 'MGSE6.RP.2', distractor: 'This is the result of a computation error.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3', distractor: 'This is the result of making a division error.' },
    ],
    remediation: 'Encourage a check step; this is fluency practice, not reteaching.',
  },
  {
    id: 'RP.ORGANIZATIONAL_ERROR',
    label: 'Organizational error (mixes up / drops numbers)',
    family: 'place_value_decimal',
    standards: ['MGSE6.RP.2', 'MGSE6.RP.3a'],
    description: 'Student mixes up which number is which, or drops a digit while organizing the work.',
    errorPattern: 'Swap the roles of two given numbers, or drop a digit, then compute.',
    diagnosticSignal: 'Needs structure/organization support more than concept reteaching.',
    examples: [
      { itemId: '1266850', standard: 'MGSE6.RP.3a', distractor: 'Student(s) may have made an organizational error and only found the quotient of 60 and 8.' },
      { itemId: 'multi', standard: 'MGSE6.RP.2', distractor: 'Student(s) may have mixed up the numbers.' },
    ],
    remediation: 'Set up a labeled table before computing so quantities keep their roles.',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 6 — EQUIVALENT RATIOS / TABLES
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.WRONG_EQUIVALENT_RATIO',
    label: 'Selects a non-equivalent ratio',
    family: 'equivalent_ratio_table',
    standards: ['MGSE6.RP.3a', '6.NR.4'],
    description: 'Student picks a ratio/table whose values are not a constant multiple of the original.',
    errorPattern: 'Choose a pair that shares a difference, or one matching value, with the target but not a constant ratio.',
    diagnosticSignal: 'Cannot yet test equivalence by the constant-multiplier criterion.',
    examples: [
      { itemId: '32314', standard: 'MGSE6.RP.3a', distractor: 'This is the result of selecting a table in which the ratio is not constant.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3a', distractor: 'Student(s) may have incorrectly simplified the ratio.' },
    ],
    remediation: 'Test every row: does numerator ÷ denominator give the same value?',
  },
  {
    id: 'RP.TABLE_EXTENSION_ERROR',
    label: 'Extends a ratio table incorrectly',
    family: 'equivalent_ratio_table',
    standards: ['MGSE6.RP.3a', 'MGSE6.RP.3d', '6.NR.4'],
    description: 'Student fills a missing table value by additive stepping or by matching the wrong column.',
    errorPattern: 'Extend the table by repeated addition of a row difference instead of applying the unit multiplier.',
    diagnosticSignal: 'Treats the table additively (linked to ADD_INSTEAD_OF_SCALE).',
    examples: [
      { itemId: 'multi', standard: 'MGSE6.RP.3a', distractor: 'This is the result of extending the table to higher values [incorrectly].' },
      { itemId: 'multi', standard: 'MGSE6.RP.3d', distractor: 'This is the result of finding the missing number in [the wrong way].' },
    ],
    remediation: 'Find the per-one multiplier, then multiply to any row.',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 7 — DATA / CHART INTERPRETATION
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.MISREAD_CHART',
    label: 'Misreads a chart / table / plotted points',
    family: 'data_interpretation',
    standards: ['MGSE6.RP.1', 'MGSE6.RP.3a', 'MGSE6.RP.3d'],
    description: 'Student reads the wrong row/column/axis or misinterprets plotted coordinate pairs.',
    errorPattern: 'Pull values from the wrong cell/series, or swap x and y when reading points.',
    diagnosticSignal: 'Representation-reading gap distinct from the underlying ratio computation.',
    examples: [
      { itemId: '243949', standard: 'MGSE6.RP.1', distractor: 'Student(s) may have incorrectly read the chart.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3d', distractor: 'This is the result of misinterpreting the points on [the graph].' },
    ],
    remediation: 'Practice reading labeled axes/headers before computing; point to the cell.',
  },

  /* ---------------------------------------------------------------------------
   * FAMILY 8 — READING / INTERPRETATION (the "psychology" items)
   * ------------------------------------------------------------------------- */
  {
    id: 'RP.MISREAD_QUESTION',
    label: 'Misreads the question / answers a different question',
    family: 'reading_interpretation',
    standards: ['MGSE6.RP.3c', 'MGSE6.RP.3d'],
    description: 'Student answers a question the prompt did not ask, or is misled by a distracting first sentence.',
    errorPattern: 'Solve a closely-related but unasked quantity (e.g. months vs years, already-completed vs remaining).',
    diagnosticSignal: 'Comprehension/attention gap, not a computation gap — flag for careful-reading support.',
    examples: [
      { itemId: '76507', standard: 'MGSE6.RP.3d', distractor: 'Student(s) may have misread the question thinking it asked how many months in a year.' },
      { itemId: 'multi', standard: 'MGSE6.RP.3c', distractor: 'Student(s) may have thought the question was a trick question.' },
    ],
    remediation: 'Restate the question in your own words before solving.',
  },
];

/* ---------------------------------------------------------------------------
 * LOOKUPS — used by the generator and analytics
 * ------------------------------------------------------------------------- */

const byId = new Map(MISCONCEPTIONS.map((m) => [m.id, m]));

/** resolve a misconception by id (e.g. from a selected distractor) */
export function getMisconception(id: string): Misconception | undefined {
  return byId.get(id);
}

/** all misconceptions that commonly surface for a given standard (MGSE or GA cluster) */
export function applicableMisconceptions(standard: string): Misconception[] {
  return MISCONCEPTIONS.filter((m) => m.standards.includes(standard));
}

/** all misconceptions in a family */
export function misconceptionsByFamily(family: MisconceptionFamily): Misconception[] {
  return MISCONCEPTIONS.filter((m) => m.family === family);
}

/** every canonical id (for validation: each generated distractor must reference one) */
export const MISCONCEPTION_IDS: string[] = MISCONCEPTIONS.map((m) => m.id);
