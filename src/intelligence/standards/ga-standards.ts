/**
 * EdKairos - Georgia standards registry (the single source of truth).
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Before this file, four separate tables each held a partial, hand-maintained
 * view of "the standards", none of them derived from the GaDOE document:
 *
 *   item-generation/mgse-ga-crosswalk.ts   7 exact MGSE rows + domain scaffolds
 *   item-generation/skill-graph.ts         8 nodes, grade-6 ratios only
 *   diagnostic-bank DIAG_CLUSTER           21 grade.strand -> cluster guesses
 *   helix-frontend/src/lib/standardsMap    ~101 skill -> {ccss, ga} display pairs
 *
 * They drifted. DIAG_CLUSTER mapped grade-6 statistics to "6.DSR.7", a code
 * that does not exist anywhere in Georgia's standards - so every grade-6 data
 * item in the bank cited a fictional standard.
 *
 * Everything now resolves THROUGH this registry, and a code that is not in the
 * registry is not a Georgia standard. That is the whole point.
 *
 * GEORGIA IS PRIMARY. CCSS is a reference label carried alongside, for parents
 * and for ingesting CCSS-coded purchased banks. It is never the target that an
 * item is generated against.
 */
import {
  GA_CLUSTERS,
  GA_EXPECTATIONS,
  GA_SOURCE,
  GA_EXTRACTED_ON,
  type GaCluster,
  type GaExpectation,
  type GaStrand,
} from './ga-standards.data';
import {
  GA_CCSS_CROSSWALK,
  type CrosswalkRow,
} from './ga-ccss-crosswalk.data';

export type { GaCluster, GaExpectation, GaStrand, CrosswalkRow };
export { GA_CLUSTERS, GA_EXPECTATIONS, GA_CCSS_CROSSWALK, GA_SOURCE, GA_EXTRACTED_ON };

/* ==========================================================================
 * Lookups
 * ======================================================================== */

const norm = (c: string): string => String(c ?? '').trim().toUpperCase().replace(/\s+/g, '');

const byExpectation = new Map(GA_EXPECTATIONS.map((e) => [norm(e.code), e]));
const byCluster = new Map(GA_CLUSTERS.map((c) => [norm(c.code), c]));
const clusterChildren = new Map<string, GaExpectation[]>();
for (const e of GA_EXPECTATIONS) {
  const k = norm(e.cluster);
  const arr = clusterChildren.get(k) ?? [];
  arr.push(e);
  clusterChildren.set(k, arr);
}

const crosswalkByGa = new Map(GA_CCSS_CROSSWALK.map((r) => [norm(r.ga), r]));
const gaByCcss = new Map<string, string[]>();
for (const r of GA_CCSS_CROSSWALK) {
  for (const c of [r.ccss, ...r.alt]) {
    if (!c) continue;
    const k = norm(c);
    gaByCcss.set(k, [...(gaByCcss.get(k) ?? []), r.ga]);
  }
}

export function getExpectation(code: string): GaExpectation | undefined {
  return byExpectation.get(norm(code));
}

export function getCluster(code: string): GaCluster | undefined {
  return byCluster.get(norm(code));
}

/** Every learning objective under a competency, e.g. "6.NR.4" -> 6.NR.4.1 .. 6.NR.4.7 */
export function expectationsForCluster(code: string): GaExpectation[] {
  return clusterChildren.get(norm(code)) ?? [];
}

export function expectationsForGrade(grade: string | number): GaExpectation[] {
  const g = String(grade).toUpperCase().replace(/^GRADE\s*/, '');
  const n = g === 'K' ? 0 : Number(g);
  return GA_EXPECTATIONS.filter((e) => (Number.isFinite(n) ? e.gradeNum === n : e.grade === g));
}

/** True only for a code that actually appears in Georgia's 2021 K-8 standards. */
export function isValidGaCode(code: string): boolean {
  const c = norm(code);
  return byExpectation.has(c) || byCluster.has(c);
}

export function gradeOfGaCode(code: string): number | null {
  const hit = getExpectation(code) ?? getCluster(code);
  return hit ? hit.gradeNum : null;
}

export function strandOfGaCode(code: string): GaStrand | null {
  const hit = getExpectation(code) ?? getCluster(code);
  return hit ? hit.strand : null;
}

/* ==========================================================================
 * Crosswalk (reference only - never a generation target)
 * ======================================================================== */

export function ccssFor(gaCode: string): CrosswalkRow | undefined {
  return crosswalkByGa.get(norm(gaCode));
}

/** Reverse: which GA objective(s) does a CCSS code correspond to. */
export function gaForCcss(ccssCode: string): string[] {
  return gaByCcss.get(norm(ccssCode)) ?? [];
}

/* ==========================================================================
 * Resolution: any incoming code -> a Georgia standard
 * ======================================================================== */

/** Legacy MGSE domain (2015 Georgia / CCSS-shaped) -> current GA competency.
 *  Coarse by nature: a domain maps to a cluster, never to one objective.
 *  6.SP maps to 6.NR.2 - Georgia files grade-6 statistics under Numerical
 *  Reasoning. The old table said "6.DSR.7", which does not exist. */
const MGSE_DOMAIN_TO_GA_CLUSTER: Record<string, string> = {
  'MGSE4.OA': '4.PAR.3', 'MGSE4.NBT': '4.NR.1', 'MGSE4.NF': '4.NR.4',
  'MGSE4.MD': '4.MDR.6', 'MGSE4.G': '4.GSR.8',
  'MGSE5.NBT': '5.NR.1', 'MGSE5.NF': '5.NR.3', 'MGSE5.OA': '5.NR.5',
  'MGSE5.MD': '5.MDR.7', 'MGSE5.G': '5.GSR.8',
  'MGSE6.RP': '6.NR.4', 'MGSE6.NS': '6.NR.1', 'MGSE6.EE': '6.PAR.6',
  'MGSE6.G': '6.GSR.5', 'MGSE6.SP': '6.NR.2',
  'MGSE7.RP': '7.PAR.4', 'MGSE7.NS': '7.NR.1', 'MGSE7.EE': '7.PAR.3',
  'MGSE7.G': '7.GSR.5', 'MGSE7.SP': '7.PR.6',
  'MGSE8.NS': '8.NR.1', 'MGSE8.EE': '8.PAR.4', 'MGSE8.F': '8.FGR.5',
  'MGSE8.G': '8.GSR.8', 'MGSE8.SP': '8.FGR.6',
};

/** The seven MGSE ratio codes that map to a single GA objective exactly. */
const MGSE_EXACT: Record<string, string> = {
  'MGSE6.RP.1': '6.NR.4.1', 'MGSE6.RP.2': '6.NR.4.4', 'MGSE6.RP.3': '6.NR.4.3',
  'MGSE6.RP.3A': '6.NR.4.2', 'MGSE6.RP.3B': '6.NR.4.5', 'MGSE6.RP.3C': '6.NR.4.6',
  'MGSE6.RP.3D': '6.NR.4.7',
};

export interface GaResolution {
  /** what was handed in */
  input: string;
  /** how the input was read */
  inputSystem: 'ga' | 'mgse' | 'ccss' | 'unknown';
  /** the GA learning objective, when the input pins one down */
  expectation: GaExpectation | null;
  /** the GA competency - always set when we resolved anything at all */
  cluster: GaCluster | null;
  /** false when we could only reach the cluster, or nothing at all */
  exact: boolean;
  /** true when the input names a standard that does not exist in GA 2021 */
  unresolved: boolean;
}

/**
 * Read any standard code the system might encounter - a current GA objective or
 * competency, a legacy MGSE code from a purchased bank, or a CCSS code - and
 * return the Georgia standard it corresponds to.
 */
export function resolveToGa(code: string): GaResolution {
  const c = norm(code);
  const empty: GaResolution = {
    input: code, inputSystem: 'unknown', expectation: null,
    cluster: null, exact: false, unresolved: true,
  };
  if (!c) return empty;

  // 1. a current Georgia code
  const exp = byExpectation.get(c);
  if (exp) {
    return {
      input: code, inputSystem: 'ga', expectation: exp,
      cluster: byCluster.get(norm(exp.cluster)) ?? null, exact: true, unresolved: false,
    };
  }
  const clu = byCluster.get(c);
  if (clu) {
    return { input: code, inputSystem: 'ga', expectation: null, cluster: clu, exact: false, unresolved: false };
  }

  // 2. a legacy MGSE code
  if (c.startsWith('MGSE')) {
    const hit = MGSE_EXACT[c];
    if (hit) {
      const e = byExpectation.get(hit)!;
      return {
        input: code, inputSystem: 'mgse', expectation: e,
        cluster: byCluster.get(norm(e.cluster)) ?? null, exact: true, unresolved: false,
      };
    }
    const prefix = Object.keys(MGSE_DOMAIN_TO_GA_CLUSTER)
      .filter((p) => c.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) {
      return {
        input: code, inputSystem: 'mgse', expectation: null,
        cluster: byCluster.get(norm(MGSE_DOMAIN_TO_GA_CLUSTER[prefix])) ?? null,
        exact: false, unresolved: false,
      };
    }
    return { ...empty, inputSystem: 'mgse' };
  }

  // 3. a CCSS code, via the crosswalk read backwards
  const ga = gaByCcss.get(c);
  if (ga && ga.length) {
    const e = byExpectation.get(norm(ga[0]))!;
    return {
      input: code, inputSystem: 'ccss', expectation: e,
      cluster: byCluster.get(norm(e.cluster)) ?? null,
      exact: ga.length === 1, unresolved: false,
    };
  }
  return empty;
}

/** Convenience: the GA competency code for any input, or null. */
export function gaClusterOf(code: string): string | null {
  return resolveToGa(code).cluster?.code ?? null;
}

/* ==========================================================================
 * Prompt block - the thing that was actually missing
 * ======================================================================== */

export interface GaPromptOptions {
  /** include the CCSS reference line (default true) */
  includeCcss?: boolean;
  /** label the block for the reader, e.g. "TARGET STANDARD" */
  heading?: string;
}

/**
 * The block that goes into a generation or tutoring prompt.
 *
 * This is the fix for the original defect. Every generator prompt used to say
 * "test the SAME standard as the base" and then hand the model a bare code -
 * "MGSE6.RP.2" - with no text. The model has no reliable knowledge of what a
 * Georgia code contains, so it fell back on whatever CCSS content it associates
 * with the topic. Feeding it Georgia's own words removes the guess.
 */
export function gaStandardBlock(code: string, opts: GaPromptOptions = {}): string {
  const { includeCcss = true, heading = 'GEORGIA STANDARD (authoritative - the item MUST assess exactly this)' } = opts;
  const r = resolveToGa(code);
  if (r.unresolved || !r.cluster) {
    return [
      `${heading}:`,
      `  The code "${code}" is not a Georgia 2021 K-8 standard. Do NOT invent a standard code.`,
      `  Infer the grade and topic from the question itself and stay faithful to it.`,
    ].join('\n');
  }
  const c = r.cluster;
  const lines = [
    `${heading}:`,
    `  Grade ${c.grade} - ${c.strandName}`,
    `  Competency ${c.code}: ${c.text}`,
  ];
  if (r.expectation) {
    lines.push(`  Learning objective ${r.expectation.code}: ${r.expectation.text}`);
  } else {
    const kids = expectationsForCluster(c.code);
    if (kids.length) {
      lines.push(`  Learning objectives in this competency (choose the one the base question actually assesses, and tag it):`);
      for (const k of kids) lines.push(`    ${k.code}: ${k.text}`);
    }
  }
  lines.push(
    `  Stay inside the grade and the wording above. Georgia places some topics at a`,
    `  different grade than other state frameworks - if the standard above does not`,
    `  call for fractions, decimals, percents or negative numbers, do not use them.`,
  );
  if (includeCcss) {
    const x = r.expectation ? ccssFor(r.expectation.code) : undefined;
    if (x?.ccss) {
      lines.push(`  (Reference only, NOT the target: the nearest Common Core standard is ${x.ccss}.${x.note ? ' ' + x.note : ''})`);
    }
  }
  lines.push(`  Tag the item with the Georgia code${r.expectation ? ` ${r.expectation.code}` : ''}.`);
  return lines.join('\n');
}

/* ==========================================================================
 * The display rule
 * ======================================================================== */

export interface DisplayStandard {
  code: string;
  text: string;
  converted: boolean;
}

/**
 * What a school is allowed to see.
 *
 * A Georgia school does not audit the database — it looks at one screen or one
 * document and sees a code. If that code is `MGSE8.EE.7` or `6.RP.A.2`, the
 * conversation ends: "that's not our standards." One wrong code in front of one
 * reviewer costs more than a thousand mis-tagged rows nobody opens.
 *
 *     Render a VERIFIED Georgia code, or render no code at all.
 *
 * A missing code is invisible; a foreign code is fatal. So this is deliberately
 * STRICTER than `resolveToGa()`. It will not use:
 *   - the legacy domain scaffold — measured 58% accurate overall, 17% for
 *     MGSE8.EE, which spans six different Georgia clusters
 *   - the CCSS crosswalk — 265 rows, none human-reviewed, and its reverse
 *     direction picks the first of several matches
 * Both are fine for ROUTING work internally. Neither is fit to make a claim to
 * a district on. Guessing is precisely what produces the wrong code.
 *
 * Returns null when no verified Georgia code exists. Callers must then render
 * the topic or description alone — never the raw stored value.
 */
export function displayGaCode(raw?: string | null): DisplayStandard | null {
  const c = norm(String(raw ?? ''));
  if (!c) return null;

  const exp = byExpectation.get(c);
  if (exp) return { code: exp.code, text: exp.text, converted: false };

  const clu = byCluster.get(c);
  if (clu) return { code: clu.code, text: clu.text, converted: false };

  // The seven MGSE ratio codes that were hand-verified against the GaDOE PDF.
  // Deliberately the only legacy conversion permitted on a display path.
  const legacy = MGSE_EXACT[c];
  if (legacy) {
    const e = byExpectation.get(norm(legacy));
    if (e) return { code: e.code, text: e.text, converted: true };
  }
  return null;
}

/** Convenience for a payload: the code alone, or null. */
export function safeStandard(raw?: string | null): string | null {
  return displayGaCode(raw)?.code ?? null;
}

/** One-line human label, e.g. "6.NR.4.1 - Explain the concept of a ratio..." */
export function gaLabel(code: string, maxLen = 120): string {
  const r = resolveToGa(code);
  const hit = r.expectation ?? r.cluster;
  if (!hit) return code;
  const t = hit.text.length > maxLen ? hit.text.slice(0, maxLen - 1).trimEnd() + '…' : hit.text;
  return `${hit.code} - ${t}`;
}

/** Registry health, for a startup log line or an admin screen. */
export function gaRegistryStats(): {
  clusters: number; expectations: number; crosswalkRows: number;
  ccssMapped: number; reviewed: number; source: string;
} {
  return {
    clusters: GA_CLUSTERS.length,
    expectations: GA_EXPECTATIONS.length,
    crosswalkRows: GA_CCSS_CROSSWALK.length,
    ccssMapped: GA_CCSS_CROSSWALK.filter((r) => !!r.ccss).length,
    reviewed: GA_CCSS_CROSSWALK.filter((r) => r.reviewed).length,
    source: GA_SOURCE,
  };
}
