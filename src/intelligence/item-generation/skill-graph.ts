/**
 * EdKairos — Diagnostic Taxonomy (Skill Graph)
 * ---------------------------------------------------------------------------
 * The backbone everything hangs off: a directed graph of skill nodes with
 * prerequisite edges. Each node is tagged with its GA standard, DOK, the best
 * figure, the misconceptions that live there (ids from misconception-library.ts),
 * and a mastery indicator.
 *
 * WHAT IT POWERS
 *  - tagging: generated items attach to a node (node.id) -> mastery is tracked
 *    per node, not per loose item.
 *  - remediation routing: when a student misses a node, walk its prerequisite
 *    edges back to the first un-mastered prerequisite and reteach THERE.
 *  - diagnosis: a selected distractor -> misconception id -> the node(s) it
 *    threatens (reverse lookup) -> targeted next step.
 *
 * SCOPE: seeded for Grade-6 Ratios & Proportional Relationships (GA cluster
 * 6.NR.4 = legacy MGSE6.RP), the span of the ingested Illuminate bank, plus the
 * cross-grade prerequisite roots that feed it. Extend node-by-node as new banks
 * and grades are ingested. Misconception ids MUST match misconception-library.ts.
 */

export type FigureType =
  | 'number_line' | 'fraction_bar' | 'rect' | 'coordinate_grid' | 'ratio_table'
  | 'decimal_grid' | 'bar_graph' | 'spinner' | 'place_value_chart' | null;

export interface SkillNode {
  id: string;                 // stable id (NEVER renumber)
  label: string;
  grade: number;
  ga: string;                 // current GA expectation/cluster
  mgse?: string;              // legacy code (if a seed bank uses it)
  gaCluster: string;
  dok: [number, number];      // typical DOK range [min,max]
  figure: FigureType;         // best representation (from the crosswalk)
  prerequisites: string[];    // node ids that should be mastered first
  misconceptions: string[];   // ids from misconception-library.ts that surface here
  masteryIndicator: string;   // what "mastered" looks like
  external?: boolean;         // true = cross-grade prerequisite root (not in-cluster)
}

export const SKILL_NODES: SkillNode[] = [
  /* ---- cross-grade prerequisite roots (feed the RP cluster) ---- */
  {
    id: 'MULT_DIV_FLUENCY', label: 'Multiplicative reasoning (x and division)',
    grade: 5, ga: '5.NR.2', gaCluster: '5.NR.2', dok: [1, 2], figure: 'rect',
    prerequisites: [], misconceptions: ['RP.MULTIPLY_INSTEAD_OF_DIVIDE', 'RP.COMPUTATION_ERROR'],
    masteryIndicator: 'Fluently multiplies and divides multi-digit whole numbers and chooses the right one for a situation.',
    external: true,
  },
  {
    id: 'FRACTION_CONCEPT', label: 'Fractions as parts of a whole / equivalence',
    grade: 5, ga: '5.NR.3', gaCluster: '5.NR.3', dok: [1, 2], figure: 'fraction_bar',
    prerequisites: [], misconceptions: [],
    masteryIndicator: 'Represents, compares, and finds equivalent fractions.',
    external: true,
  },
  {
    id: 'DECIMAL_CONCEPT', label: 'Decimal place value (tenths-thousandths)',
    grade: 5, ga: '5.NR.4', gaCluster: '5.NR.4', dok: [1, 2], figure: 'decimal_grid',
    prerequisites: [], misconceptions: ['RP.DECIMAL_PLACEMENT'],
    masteryIndicator: 'Reads, writes, and operates on decimals with correct place value.',
    external: true,
  },

  /* ---- Grade 6 . cluster 6.NR.4 (= MGSE6.RP) ---- */
  {
    id: 'RATIO_CONCEPT', label: 'Concept of a ratio & ratio language',
    grade: 6, ga: '6.NR.4.1', mgse: 'MGSE6.RP.1', gaCluster: '6.NR.4', dok: [1, 2], figure: 'ratio_table',
    prerequisites: ['MULT_DIV_FLUENCY', 'FRACTION_CONCEPT'],
    misconceptions: ['RP.DIFFERENCE_NOT_RATIO', 'RP.MISREAD_CHART'],
    masteryIndicator: 'Describes a relationship between two quantities multiplicatively using part-to-part and part-to-whole language.',
  },
  {
    id: 'EQUIVALENT_RATIOS', label: 'Equivalent-ratio tables & plotting',
    grade: 6, ga: '6.NR.4.2', mgse: 'MGSE6.RP.3a', gaCluster: '6.NR.4', dok: [2, 2], figure: 'ratio_table',
    prerequisites: ['RATIO_CONCEPT'],
    misconceptions: ['RP.WRONG_EQUIVALENT_RATIO', 'RP.TABLE_EXTENSION_ERROR', 'RP.ADD_INSTEAD_OF_SCALE'],
    masteryIndicator: 'Generates equivalent ratios, finds missing table values by the constant multiplier, and plots the pairs.',
  },
  {
    id: 'UNIT_RATE', label: 'Rates & unit rate',
    grade: 6, ga: '6.NR.4.4', mgse: 'MGSE6.RP.2', gaCluster: '6.NR.4', dok: [1, 2], figure: 'number_line',
    prerequisites: ['RATIO_CONCEPT', 'MULT_DIV_FLUENCY'],
    misconceptions: ['RP.INVERTED_RATE', 'RP.NO_UNIT_RATE', 'RP.MULTIPLY_INSTEAD_OF_DIVIDE', 'RP.ORGANIZATIONAL_ERROR'],
    masteryIndicator: 'Finds and interprets the per-one value (a/b, b not 0) for a ratio relationship.',
  },
  {
    id: 'PROPORTIONS', label: 'Solve proportions (multiple strategies)',
    grade: 6, ga: '6.NR.4.3', mgse: 'MGSE6.RP.3', gaCluster: '6.NR.4', dok: [2, 3], figure: 'ratio_table',
    prerequisites: ['EQUIVALENT_RATIOS', 'UNIT_RATE'],
    misconceptions: ['RP.ADD_INSTEAD_OF_SCALE', 'RP.WRONG_OPERATION'],
    masteryIndicator: 'Selects and applies a valid strategy (table, double number line, unit rate, equation) to solve a proportion.',
  },
  {
    id: 'UNIT_RATE_PROBLEMS', label: 'Unit pricing & constant speed',
    grade: 6, ga: '6.NR.4.5', mgse: 'MGSE6.RP.3b', gaCluster: '6.NR.4', dok: [2, 3], figure: 'number_line',
    prerequisites: ['UNIT_RATE'],
    misconceptions: ['RP.MULTIPLY_INSTEAD_OF_DIVIDE', 'RP.SUBTRACT_INSTEAD_OF_DIVIDE', 'RP.DECIMAL_PLACEMENT'],
    masteryIndicator: 'Applies unit rate to compare prices and to relate distance, rate, and time.',
  },
  {
    id: 'PERCENT', label: 'Percent as a rate per 100',
    grade: 6, ga: '6.NR.4.6', mgse: 'MGSE6.RP.3c', gaCluster: '6.NR.4', dok: [2, 3], figure: 'fraction_bar',
    prerequisites: ['UNIT_RATE', 'FRACTION_CONCEPT', 'DECIMAL_CONCEPT'],
    misconceptions: ['RP.PERCENT_COMPLEMENT', 'RP.PART_FOR_WHOLE', 'RP.MISREAD_QUESTION'],
    masteryIndicator: 'Finds a percent of a quantity and the whole given a part and percent; connects fractions/decimals/percents.',
  },
  {
    id: 'MEASUREMENT_CONVERSION', label: 'Convert measurement units by ratios',
    grade: 6, ga: '6.NR.4.7', mgse: 'MGSE6.RP.3d', gaCluster: '6.NR.4', dok: [2, 2], figure: 'ratio_table',
    prerequisites: ['PROPORTIONS', 'UNIT_RATE'],
    misconceptions: ['RP.INVERTED_RATE', 'RP.DECIMAL_PLACEMENT'],
    masteryIndicator: 'Uses a conversion factor as a ratio to convert within and between customary and metric systems.',
  },
];

/* ===========================================================================
 * LOOKUPS & TRAVERSAL
 * ========================================================================= */
const byId = new Map(SKILL_NODES.map((n) => [n.id, n]));

export function getNode(id: string): SkillNode | undefined { return byId.get(id); }

/** direct prerequisites */
export function prerequisitesOf(id: string): SkillNode[] {
  const n = byId.get(id);
  return n ? n.prerequisites.map((p) => byId.get(p)).filter(Boolean) as SkillNode[] : [];
}

/** all transitive prerequisites (cycle-safe), nearest-first */
export function allPrerequisites(id: string): SkillNode[] {
  const out: SkillNode[] = [];
  const seen = new Set<string>([id]);
  const queue = [...(byId.get(id)?.prerequisites ?? [])];
  while (queue.length) {
    const pid = queue.shift() as string;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const node = byId.get(pid);
    if (node) { out.push(node); queue.push(...node.prerequisites); }
  }
  return out;
}

/**
 * Remediation path: given the target node and a predicate telling us which
 * nodes the student has NOT mastered, return the ordered chain to reteach
 * (deepest un-mastered prerequisite first, up to the target).
 */
export function remediationPath(id: string, isUnmastered: (nodeId: string) => boolean): SkillNode[] {
  const chain = [byId.get(id), ...allPrerequisites(id)].filter(Boolean) as SkillNode[];
  const unmastered = chain.filter((n) => isUnmastered(n.id));
  // deepest prereq first: prerequisites come after the node in allPrerequisites,
  // so reverse to teach foundational gaps before the target.
  return unmastered.reverse();
}

/** every node that targets a given standard (MGSE or GA) */
export function nodesForStandard(code: string): SkillNode[] {
  const c = code.trim().toUpperCase();
  return SKILL_NODES.filter((n) =>
    n.ga.toUpperCase() === c || n.gaCluster.toUpperCase() === c || (n.mgse?.toUpperCase() === c));
}

/** reverse lookup: which skills does this misconception threaten */
export function nodesForMisconception(misconceptionId: string): SkillNode[] {
  return SKILL_NODES.filter((n) => n.misconceptions.includes(misconceptionId));
}

export const SKILL_IDS: string[] = SKILL_NODES.map((n) => n.id);
