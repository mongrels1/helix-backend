/**
 * EdKairos · diagnostic-bank · deterministic item resolver (PURE LOGIC)
 * ---------------------------------------------------------------------------
 * Independently RE-SOLVES an existing multiple-choice item for the computable
 * families (circle area/circumference, composite rect+semicircle area,
 * concentric/ring area & "all of the above" multi-statement, rectangle &
 * triangle area/perimeter, angle relationships as value OR "which equation")
 * and reports whether the KEYED option is actually correct.
 *
 * This is the piece the structural gate (reliability-gate.ts) and the LLM judge
 * never provided: a numeric re-key check that CANNOT time out and CANNOT fail
 * open. It reads an item the same whether it came from generation or import, so
 * the sweep, the import path, and the generator all validate the same way.
 *
 * Design rules:
 *  - No NestJS, no I/O, no LLM — importable + unit-testable.
 *  - Conservative: a family resolver returns null unless it is confident it
 *    understands the item. Unknown families => verdict 'unsupported' (the caller
 *    may still fall back to the LLM judge for those). We would rather MISS a
 *    mis-key than FALSELY reject a correct item.
 */

export type Verdict =
  | 'confirmed'       // keyed option matches the independently computed answer
  | 'mis_keyed'       // keyed option is wrong; a different option is the true answer
  | 'no_correct_option' // the true answer matches NO option — the item is broken
  | 'ambiguous'       // 2+ options are defensibly correct
  | 'unsupported';    // no deterministic resolver understands this item

export interface ResolvableItem {
  stem?: string | null;
  /** {text,correct}[] (generated bank) OR string[] (diagnostic bank) OR JSON string */
  options?: unknown;
  /** 0-based correct index (diagnostic bank) */
  correct?: number | null;
  /** correct option text (generated bank) */
  answer?: string | null;
  standard?: string | null;
  figure?: unknown;
}

export interface ResolveResult {
  verdict: Verdict;
  family: string | null;
  /** the option index this resolver believes is correct (when known) */
  trueIndex: number | null;
  keyedIndex: number | null;
  note?: string;
}

// ---- option normalization -------------------------------------------------

interface NormOption { text: string; keyed: boolean }

function normalizeOptions(item: ResolvableItem): NormOption[] {
  let raw: unknown = item.options;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = []; } }
  if (!Array.isArray(raw)) return [];

  const asObj = raw.every((o) => o && typeof o === 'object' && !Array.isArray(o));
  const opts: NormOption[] = raw.map((o) => {
    if (o && typeof o === 'object') {
      const r = o as { text?: unknown; correct?: unknown };
      return { text: String(r.text ?? ''), keyed: r.correct === true };
    }
    return { text: String(o ?? ''), keyed: false };
  });

  // If a numeric `correct` index is provided (diagnostic bank), it wins.
  if (typeof item.correct === 'number' && item.correct >= 0 && item.correct < opts.length) {
    opts.forEach((o, i) => (o.keyed = i === item.correct));
  } else if (!asObj && item.answer != null) {
    // string[] options + an answer text: mark the matching option.
    const a = String(item.answer).trim().toLowerCase();
    opts.forEach((o) => (o.keyed = o.text.trim().toLowerCase() === a));
  } else if (asObj && !opts.some((o) => o.keyed) && item.answer != null) {
    const a = String(item.answer).trim().toLowerCase();
    opts.forEach((o) => (o.keyed = o.text.trim().toLowerCase() === a));
  }
  return opts;
}

// ---- magnitude parsing ----------------------------------------------------

interface Mag { value: number; piCoeff: number | null }

/** Parse an option's numeric magnitude. "64π" -> {value:64π, piCoeff:64};
 *  "137.1 square inches" -> {value:137.1, piCoeff:null}; "√52 m" -> sqrt. */
function parseMagnitude(text: string): Mag | null {
  const t = text.toLowerCase().replace(/,/g, '').trim();
  // NB: no \b after π — π is not a word char, so \b never matches between it and a
  // following space, which silently broke every "Nπ" option. Match π directly, and
  // "pi" only when not followed by another letter (so "pixel" is not a π value).
  const pi = t.match(/(-?\d+(?:\.\d+)?)\s*π/) ?? t.match(/(-?\d+(?:\.\d+)?)\s*pi(?![a-z])/);
  if (pi) { const c = Number(pi[1]); return { value: c * Math.PI, piCoeff: c }; }
  const sqrt = t.match(/(?:√|sqrt)\s*\(?\s*(\d+(?:\.\d+)?)/);
  if (sqrt) return { value: Math.sqrt(Number(sqrt[1])), piCoeff: null };
  const n = t.match(/-?\d+(?:\.\d+)?/);
  if (n) return { value: Number(n[0]), piCoeff: null };
  return null;
}

function allNums(s: string): number[] {
  return (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** Does an option magnitude match a computed true magnitude?
 *  - both exact in π: compare coefficients exactly.
 *  - otherwise: numeric within tolerance (looser when the stem says "approximate"). */
function magMatch(opt: Mag, truth: Mag, approx: boolean): boolean {
  if (truth.piCoeff != null && opt.piCoeff != null) {
    return Math.abs(truth.piCoeff - opt.piCoeff) < 1e-6;
  }
  // Keep the tolerance tight enough that two genuinely-distinct distractors never
  // both match, but loose enough to absorb rounding ("approximate"/π≈3.14) — so a
  // true 137.13 accepts a 137.1 option without also swallowing a 138 distractor.
  const tol = Math.max(approx ? 0.6 : 0.15, Math.abs(truth.value) * 0.004);
  return Math.abs(opt.value - truth.value) <= tol;
}

// ---- computed truth for a family ------------------------------------------

interface Truth { mag?: Mag; text?: string; family: string; note?: string }

/** each family resolver: return a computed truth, or null if it does not apply */
type FamilyResolver = (stem: string, opts: NormOption[]) => Truth | null;

const num = (s: string, re: RegExp): number | null => {
  const m = s.match(re);
  return m ? Number(m[1]) : null;
};

/** radius from "radius of R" / "radius R"; falls back to diameter/2. */
function radiusOf(s: string): number | null {
  const r = num(s, /radius\s+(?:of\s+)?(\d+(?:\.\d+)?)/) ?? num(s, /(\d+(?:\.\d+)?)[- ]?(?:inch|cm|m|ft|unit)[a-z]*\s+radius/);
  if (r != null) return r;
  const d = num(s, /diameter\s+(?:of\s+)?(\d+(?:\.\d+)?)/);
  return d != null ? d / 2 : null;
}

const hasAny = (s: string, ...w: string[]) => w.some((x) => s.includes(x));

// --- circle area (single circle) ---
const circleArea: FamilyResolver = (s) => {
  if (!hasAny(s, 'circle') || !s.includes('area')) return null;
  if (hasAny(s, 'rectangle', 'semicircle', 'square', 'triangle', 'trapezoid')) return null; // composite -> other resolver
  const radii = [...s.matchAll(/radius\s+(?:of\s+)?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (radii.length !== 1) return null; // 0 or 2+ radii -> not a single-circle area
  const r = radii[0];
  return { mag: { value: Math.PI * r * r, piCoeff: r * r }, family: 'circle_area' };
};

// --- circle circumference ---
const circleCircumference: FamilyResolver = (s) => {
  if (!s.includes('circle') || !hasAny(s, 'circumference', 'around the circle')) return null;
  const r = radiusOf(s);
  if (r == null) return null;
  return { mag: { value: 2 * Math.PI * r, piCoeff: 2 * r }, family: 'circle_circumference' };
};

// --- composite: rectangle + semicircle ---
const compositeRectSemicircle: FamilyResolver = (s) => {
  if (!s.includes('semicircle') || !hasAny(s, 'rectangle', 'rectangular')) return null;
  const w = num(s, /width\s+(?:of\s+)?(\d+(?:\.\d+)?)/);
  const l = num(s, /length\s+(?:of\s+)?(\d+(?:\.\d+)?)/);
  if (w == null || l == null) return null;
  const shorter = Math.min(w, l), longer = Math.max(w, l);
  // which side the semicircle sits on determines its diameter
  let d: number | null = null;
  if (/shorter side/.test(s)) d = shorter;
  else if (/longer side/.test(s)) d = longer;
  if (d == null) return { family: 'composite_rect_semicircle', note: 'side-of-attachment unspecified (ambiguous)' };
  const rad = d / 2;
  const area = w * l + 0.5 * Math.PI * rad * rad;
  return { mag: { value: area, piCoeff: null }, family: 'composite_rect_semicircle' };
};

// --- rectangle area / perimeter ---
const rectangle: FamilyResolver = (s) => {
  if (!hasAny(s, 'rectangle', 'rectangular')) return null;
  if (s.includes('semicircle')) return null;
  const w = num(s, /width\s+(?:of\s+)?(\d+(?:\.\d+)?)/) ?? num(s, /(\d+(?:\.\d+)?)\s*(?:by|×|x)\s*\d+/);
  const l = num(s, /length\s+(?:of\s+)?(\d+(?:\.\d+)?)/) ?? num(s, /\d+\s*(?:by|×|x)\s*(\d+(?:\.\d+)?)/);
  if (w == null || l == null) return null;
  if (s.includes('perimeter')) return { mag: { value: 2 * (w + l), piCoeff: null }, family: 'rectangle_perimeter' };
  if (s.includes('area')) return { mag: { value: w * l, piCoeff: null }, family: 'rectangle_area' };
  return null;
};

// --- triangle area ---
const triangleArea: FamilyResolver = (s) => {
  if (!s.includes('triangle') || !s.includes('area')) return null;
  const b = num(s, /base\s+(?:of\s+)?(\d+(?:\.\d+)?)/);
  const h = num(s, /height\s+(?:of\s+)?(\d+(?:\.\d+)?)/);
  if (b == null || h == null) return null;
  return { mag: { value: 0.5 * b * h, piCoeff: null }, family: 'triangle_area' };
};

// --- angle relationship: value OR "which equation" ---
const angleRelationship: FamilyResolver = (s, opts) => {
  const known = num(s, /measures?\s+(\d+(?:\.\d+)?)\s*(?:°|degree)/) ?? num(s, /(\d+(?:\.\d+)?)\s*(?:°|degrees)/);
  if (known == null) return null;
  let total: number | null = null;
  let rel: 'sum' | 'equal' | null = null;
  if (hasAny(s, 'straight line', 'straight angle', 'supplementary', 'linear pair')) { total = 180; rel = 'sum'; }
  else if (hasAny(s, 'complementary', 'right angle')) { total = 90; rel = 'sum'; }
  else if (s.includes('vertical')) { rel = 'equal'; }
  if (rel == null) return null;

  const asksEquation = hasAny(s, 'which equation', 'equation can be solved', 'equation could be used', 'equation represents');
  if (asksEquation) {
    // The correct option is the equation encoding the relationship.
    const want = rel === 'equal'
      // The correct vertical-angle equation is just "x = <known>". Reject options whose
      // LEFT side contains an OPERATOR (e.g. "x + 30 = ..."), but NOT the variable letter
      // x itself — the old class [+\-×x*] included "x" and so rejected the right answer.
      ? (o: string) => new RegExp(`=\\s*${known}\\b`).test(o) && !/[+\-×*/]/.test(o.replace(/=.*/, ''))
      : (o: string) => {
          const ns = allNums(o);
          return o.includes('+') && o.includes(String(known)) && ns.includes(total as number);
        };
    const idx = opts.findIndex((o) => want(o.text.toLowerCase()));
    if (idx < 0) return { family: 'angle_equation', note: 'no option matches the relationship equation' };
    return { text: opts[idx].text, family: 'angle_equation' };
  }
  // value form
  const val = rel === 'equal' ? known : (total as number) - known;
  return { mag: { value: val, piCoeff: null }, family: 'angle_value' };
};

// --- concentric / "all of the above" multi-statement areas ---
const multiStatementAreas: FamilyResolver = (s, opts) => {
  const radii = [...s.matchAll(/radius\s+(?:of\s+)?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (radii.length < 2) return null;
  if (!hasAny(s, 'all of the above', 'which statement', 'true about')) return null;
  const R = Math.max(...radii), r = Math.min(...radii);
  const outer = R * R, inner = r * r, ring = R * R - r * r; // π-coefficients
  const truthOf = (text: string): boolean | null => {
    const t = text.toLowerCase();
    if (/all of the above/.test(t)) return null; // resolved after the others
    const m = parseMagnitude(t);
    if (!m || m.piCoeff == null) return null;
    if (hasAny(t, 'larger', 'outer', 'big')) return Math.abs(m.piCoeff - outer) < 1e-6;
    if (hasAny(t, "bull", 'smaller', 'inner')) return Math.abs(m.piCoeff - inner) < 1e-6;
    if (hasAny(t, 'ring', 'between', 'region')) return Math.abs(m.piCoeff - ring) < 1e-6;
    return null;
  };
  const truths = opts.map((o) => truthOf(o.text));
  const nonAll = truths.filter((v) => v !== null) as boolean[];
  const allTrue = nonAll.length > 0 && nonAll.every((v) => v === true);
  // find the "all of the above" option
  const allIdx = opts.findIndex((o) => /all of the above/.test(o.text.toLowerCase()));
  if (allIdx >= 0 && allTrue) return { text: opts[allIdx].text, family: 'concentric_all_true' };
  // otherwise the single true statement (if exactly one)
  const trueIdxs = truths.map((v, i) => (v === true ? i : -1)).filter((i) => i >= 0);
  if (trueIdxs.length === 1) return { text: opts[trueIdxs[0]].text, family: 'concentric_statement' };
  return { family: 'concentric', note: 'could not resolve a single true statement' };
};

const FAMILIES: FamilyResolver[] = [
  multiStatementAreas,
  compositeRectSemicircle,
  circleCircumference,
  circleArea,
  rectangle,
  triangleArea,
  angleRelationship,
];

// ---- top-level resolve ----------------------------------------------------

export function resolveItem(item: ResolvableItem): ResolveResult {
  const stem = String(item.stem ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const opts = normalizeOptions(item);
  const keyedIndex = opts.findIndex((o) => o.keyed);
  if (!stem || opts.length < 2 || keyedIndex < 0) {
    return { verdict: 'unsupported', family: null, trueIndex: null, keyedIndex: keyedIndex < 0 ? null : keyedIndex };
  }
  const approx = /approximate|about|estimate|closest|nearest|round/.test(stem);

  // Figure-aware re-solve first (tables / plotted ordered pairs) — the family
  // resolvers below are stem-only and cannot see the figure.
  const figTruth = resolveFromFigure(item);
  if (figTruth && (figTruth.mag || figTruth.text != null)) {
    let matchIdx: number[];
    if (figTruth.text != null) {
      const want = figTruth.text.replace(/\s+/g, '').toLowerCase();
      matchIdx = opts.map((o, i) => (o.text.replace(/\s+/g, '').toLowerCase() === want ? i : -1)).filter((i) => i >= 0);
    } else {
      const truthMag = figTruth.mag!;
      matchIdx = opts.map((o, i) => ({ i, m: parseMagnitude(o.text) })).filter((x) => x.m && magMatch(x.m, truthMag, approx)).map((x) => x.i);
    }
    if (matchIdx.length > 0) {
      const keyedMatches = matchIdx.includes(keyedIndex);
      return keyedMatches
        ? { verdict: matchIdx.length > 1 ? 'ambiguous' : 'confirmed', family: figTruth.family, trueIndex: matchIdx[0], keyedIndex }
        : { verdict: 'mis_keyed', family: figTruth.family, trueIndex: matchIdx[0], keyedIndex, note: figTruth.note ?? 'keyed option does not match the figure' };
    }
    return { verdict: 'no_correct_option', family: figTruth.family, trueIndex: null, keyedIndex, note: figTruth.note };
  }

  // Ratio/proportion: flag a keyed answer that is not proportional to the given ratio.
  const ratioCands = ratioCandidates(stem);
  if (ratioCands) {
    const matchIdx = opts
      .map((o, i) => ({ i, m: parseMagnitude(o.text) }))
      .filter((x) => x.m && ratioCands.some((c) => magMatch(x.m!, { value: c, piCoeff: null }, approx)))
      .map((x) => x.i);
    if (matchIdx.length && !matchIdx.includes(keyedIndex)) {
      return { verdict: 'mis_keyed', family: 'ratio_proportion', trueIndex: matchIdx[0], keyedIndex, note: 'keyed answer is not proportional to the given ratio' };
    }
  }

  for (const fam of FAMILIES) {
    let truth: Truth | null;
    try { truth = fam(stem, opts); } catch { truth = null; }
    if (!truth) continue;
    if (!truth.mag && !truth.text) {
      // resolver applied but could not compute (ambiguous / unhandled sub-case)
      return { verdict: 'ambiguous', family: truth.family, trueIndex: null, keyedIndex, note: truth.note };
    }

    // Determine which options match the computed truth.
    let matchIdx: number[];
    if (truth.text != null) {
      matchIdx = opts.map((o, i) => (o.text.trim().toLowerCase() === truth!.text!.trim().toLowerCase() ? i : -1)).filter((i) => i >= 0);
    } else {
      const truthMag = truth.mag!;
      matchIdx = opts
        .map((o, i) => ({ i, m: parseMagnitude(o.text) }))
        .filter((x) => x.m && magMatch(x.m, truthMag, approx))
        .map((x) => x.i);
    }

    if (matchIdx.length === 0) {
      return { verdict: 'no_correct_option', family: truth.family, trueIndex: null, keyedIndex, note: truth.note };
    }
    const keyedMatches = matchIdx.includes(keyedIndex);
    if (keyedMatches) {
      const verdict: Verdict = matchIdx.length > 1 ? 'ambiguous' : 'confirmed';
      return { verdict, family: truth.family, trueIndex: matchIdx[0], keyedIndex, note: matchIdx.length > 1 ? `${matchIdx.length} options match the computed answer` : truth.note };
    }
    // keyed does NOT match the computed answer
    return {
      verdict: 'mis_keyed',
      family: truth.family,
      trueIndex: matchIdx[0],
      keyedIndex,
      note: matchIdx.length > 1 ? `keyed option is wrong; ${matchIdx.length} options match the true answer (also ambiguous)` : (truth.note ?? 'keyed option does not match the computed answer'),
    };
  }
  return { verdict: 'unsupported', family: null, trueIndex: null, keyedIndex };
}

// ---- figure completeness --------------------------------------------------

export type FigureVerdict = 'ok' | 'missing' | 'incomplete' | 'na';

export interface FigureResult { verdict: FigureVerdict; reason?: string }

function figureType(figure: unknown): string | null {
  let f: unknown = figure;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { return null; } }
  if (!f || typeof f !== 'object') return null;
  const t = (f as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}

const SINGLE_PRIMITIVES = new Set(['circle', 'rect', 'rectangle', 'triangle', 'right_triangle', 'angle', 'square', 'geometry2d']);
const FLAT_TYPES = new Set(['circle', 'rect', 'rectangle', 'triangle', 'right_triangle', 'angle', 'angle_pair', 'square', 'geometry2d']);
const SOLID_NOUNS = ['pyramid', 'prism', 'cylinder', 'cone', 'sphere', 'cube', 'solid'];

/**
 * A figure is INCOMPLETE when the stem describes a compound/multi-part shape but
 * the attached figure carries only a single primitive — the "one circle drawn for
 * a two-circle problem" / "rectangle drawn for a rectangle+semicircle" defect that
 * figureIsSane (numbers-in-text) and factCheck (figure present at all) both miss.
 */
/**
 * STRICT "this item truly needs an attached figure" test — used for hard blocking.
 * Unlike the loose stemReferencesFigure (which treats bare "the circle"/"the
 * rectangle" as figure-referencing, fine only as a warning), this fires only on
 * strong signals: "shown below/above", "the diagram/graph/grid/number line", a
 * coordinate/ordered-pair/point reference. A plain "area of the circle" word
 * problem does NOT need a figure and must not be blocked.
 */
const REQUIRES_FIGURE_RE = /(shown|pictured|graphed|plotted|drawn|given)\s+(below|above)|\bthe (figure|diagram|graph|grid|number line)\b|in the (figure|diagram|graph)|following (figure|diagram|graph)|ordered pair\b|location of point\b|which point (is )?(located|at)\b|on the coordinate (grid|plane)\b|the coordinate (grid|plane)\b/;
export function stemRequiresFigure(stem: string | null | undefined): boolean {
  return REQUIRES_FIGURE_RE.test(String(stem ?? '').toLowerCase());
}

export function figureCompleteness(stemRaw: string | null | undefined, figure: unknown): FigureResult {
  const s = String(stemRaw ?? '').toLowerCase().replace(/\s+/g, ' ');
  const type = figureType(figure);

  const compound =
    /composed of|made up of|consists? of|combination of/.test(s) ||
    /(rectangle|square|triangle)\s+and\s+a\s+(semicircle|semi-circle|circle|triangle|rectangle)/.test(s) ||
    /\bsemicircle\b.*\b(attached|added|on (?:one|the))/.test(s);
  const twoCircles =
    /concentric/.test(s) ||
    /two circles/.test(s) ||
    (/(bull'?s[- ]?eye)/.test(s) && /circle/.test(s)) ||
    (/(larger|outer)\s+circle/.test(s) && /(smaller|inner|bull)/.test(s));

  // Solid-vs-flat: the stem says a 3-D solid is SHOWN, but the attached figure is a
  // flat 2-D primitive (e.g. a bare square drawn for "the diagram shows a right
  // square pyramid"). sanitizeFigure misses this when the solid's name shares a word
  // with the flat shape ("square" pyramid -> square).
  const showsSolid = SOLID_NOUNS.some((n) => new RegExp(`(shows?|diagram|figure|pictured|below)[^.]*\\b${n}\\b|\\b${n}\\b[^.]*(shown|pictured|below|diagram)`).test(s));
  if (showsSolid && type && FLAT_TYPES.has(type)) {
    return { verdict: 'incomplete', reason: `stem shows a 3-D solid but the figure is a flat 2-D ${type}` };
  }

  if (!compound && !twoCircles) return { verdict: 'na' };
  if (!type) return { verdict: 'missing', reason: compound ? 'stem describes a composite figure but none is attached' : 'stem describes two/concentric circles but none is attached' };

  if (twoCircles && (type === 'circle')) {
    return { verdict: 'incomplete', reason: 'stem describes two/concentric circles but the figure is a single circle' };
  }
  if (compound && SINGLE_PRIMITIVES.has(type)) {
    return { verdict: 'incomplete', reason: `stem describes a composite figure but the figure is a single ${type}` };
  }
  return { verdict: 'ok' };
}

// ---- figure VALIDITY: three production-observed validity failures ----------
// Not caught by figureCompleteness (shape) or figureIsSane (numbers-in-text):
//  (1) a figure that REVEALS the asked-for value — a point labeled with its own
//      coordinates on a "name the coordinates / ordered pair" item;
//  (2) off-grade coordinates — grade <=5 is first-quadrant, whole-number only;
//  (3) options that NAME plotted points (Point W/X/Y/Z) that aren't on the figure.
// Each destroys diagnostic validity, so these hard-block in the judge.
const gradeOfStandard = (std: string | null | undefined): number | null => {
  const m = String(std ?? '').match(/(?:MGSE)?\s*(\d+)\s*\./i);
  return m ? Number(m[1]) : null;
};
const looksLikeCoordLabel = (lab: unknown): boolean =>
  /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/.test(String(lab == null ? '' : lab));

export function figureValidityGate(
  stemRaw: string | null | undefined,
  options: string[],
  figure: unknown,
  standard: string | null | undefined,
): { ok: boolean; reason?: string } {
  let f: unknown = figure;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { return { ok: true }; } }
  if (!f || typeof f !== 'object') return { ok: true };
  const fig = f as Record<string, unknown>;
  const type = typeof fig.type === 'string' ? fig.type : '';
  const s = String(stemRaw ?? '').toLowerCase();
  const grade = gradeOfStandard(standard);
  const pts = Array.isArray(fig.points) ? (fig.points as Array<Record<string, unknown>>) : [];

  // (1) answer-revealing coordinate labels
  const asksCoords = /\bordered pair\b|coordinates?\s+of|which point[^.?]*located at|location of (?:the )?point|name(?:s)? the (?:location|point|ordered pair)|what (?:ordered pair|point)/.test(s);
  if (type === 'coordinate_grid' && asksCoords && pts.some((p) => looksLikeCoordLabel(p?.label))) {
    return { ok: false, reason: 'figure labels a point with its coordinates on a name-the-coordinates item (reveals the answer)' };
  }

  // (2) grade-band coordinate sanity (grade <=5 -> first quadrant, whole numbers)
  if ((type === 'coordinate_grid' || type === 'transformation') && grade !== null && grade <= 5) {
    const pre = Array.isArray(fig.preimage) ? (fig.preimage as Array<Record<string, unknown>>) : [];
    const img = Array.isArray(fig.image) ? (fig.image as Array<Record<string, unknown>>) : [];
    const bad = [...pts, ...pre, ...img].some(
      (p) => p && (Number(p.x) < 0 || Number(p.y) < 0 || !Number.isInteger(Number(p.x)) || !Number.isInteger(Number(p.y))),
    );
    if (bad) return { ok: false, reason: `grade ${grade} coordinate figure has negative or fractional points (must be first-quadrant whole numbers)` };
  }

  const figLabels = new Set(pts.map((p) => String(p?.label ?? '').trim().toUpperCase()).filter(Boolean));

  // (3) figure<->option coherence: options that name plotted points must exist on the figure
  const refs = options
    .map((o) => { const m = String(o).trim().match(/^(?:point\s+)?([A-Za-z])$/i); return m ? m[1].toUpperCase() : null; })
    .filter((r): r is string => !!r);
  if (refs.length >= 2) {
    if (pts.length === 0) return { ok: false, reason: 'options name points but the figure has no labeled points' };
    const missing = refs.filter((r) => !figLabels.has(r));
    if (missing.length) return { ok: false, reason: `options reference points ${missing.join(', ')} that are not labeled on the figure` };
  }

  // (4) stem<->figure coherence: a specific "point <L>" named in the stem must be plotted
  if (type === 'coordinate_grid' && figLabels.size) {
    const stemRefs = [...String(stemRaw ?? '').matchAll(/\bpoint\s+([A-Z])\b/g)].map((m) => m[1].toUpperCase());
    const missing = [...new Set(stemRefs)].filter((r) => !figLabels.has(r));
    if (missing.length) return { ok: false, reason: `stem references point ${missing.join(', ')} but the figure plots ${[...figLabels].join(', ') || 'no labeled point'}` };
  }
  return { ok: true };
}

/**
 * Figure-aware re-solve: the stem-only family resolvers never see the figure, but
 * some items are only answerable FROM it — a "continue the pattern" table, or the
 * ordered pair of a plotted point. Returns a computed truth (mag or text) or null.
 */
function resolveFromFigure(item: ResolvableItem): { mag?: Mag; text?: string; family: string; note?: string } | null {
  let f: unknown = item.figure;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch { return null; } }
  if (!f || typeof f !== 'object') return null;
  const fig = f as Record<string, unknown>;
  const s = String(item.stem ?? '').toLowerCase();

  // "based on the pattern in the table, ... after N ..." — proportional or linear.
  let pairs: [number, number][] = [];
  const rows = Array.isArray(fig.rows) ? (fig.rows as Array<Record<string, unknown>>) : [];
  if (fig.type === 'function_table') pairs = rows.map((r) => [Number(r.in), Number(r.out)] as [number, number]);
  else if (fig.type === 'ratio_table') pairs = rows.map((r) => [Number(r.a), Number(r.b)] as [number, number]);
  pairs = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length >= 2) {
    const inputs = new Set(pairs.map((p) => p[0]));
    const m = s.match(/\b(?:after|at|when|for|reach(?:es)?|by)\s+(\d+)\b/);
    let target: number | null = m ? Number(m[1]) : null;
    if (target == null) { const ns = (s.match(/\d+/g) ?? []).map(Number).filter((n) => !inputs.has(n)); target = ns.length ? Math.max(...ns) : null; }
    if (target != null) {
      const ks = pairs.map(([a, b]) => (a !== 0 ? b / a : NaN));
      if (ks.every((k) => Math.abs(k - ks[0]) < 1e-9) && Number.isFinite(ks[0])) return { mag: { value: ks[0] * target, piCoeff: null }, family: 'table_proportional' };
      const slopes: number[] = []; let linear = true;
      for (let i = 1; i < pairs.length; i++) { const da = pairs[i][0] - pairs[i - 1][0]; if (da === 0) { linear = false; break; } slopes.push((pairs[i][1] - pairs[i - 1][1]) / da); }
      if (linear && slopes.length && slopes.every((mm) => Math.abs(mm - slopes[0]) < 1e-9)) {
        const mm = slopes[0]; const b = pairs[0][1] - mm * pairs[0][0];
        return { mag: { value: mm * target + b, piCoeff: null }, family: 'table_linear' };
      }
    }
  }

  // "what is the ordered pair for point L" — read L's plotted coordinates.
  if (fig.type === 'coordinate_grid' && Array.isArray(fig.points)) {
    const m = s.match(/ordered pair\b[^.?]*?\bpoint\s+([a-z])\b/);
    if (m) {
      const L = m[1].toUpperCase();
      const p = (fig.points as Array<Record<string, unknown>>).find((q) => String(q?.label ?? '').trim().toUpperCase() === L);
      if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) return { text: `(${p.x}, ${p.y})`, family: 'ordered_pair' };
    }
  }
  return null;
}

/**
 * Ratio/proportion candidates: for "the ratio of X to Y is a:b … given N …, how
 * many …?", the answer must be N·a/b or N·b/a. Returns the two candidate values (or
 * null when it can't be sure). Used ONLY to FLAG a keyed option that matches neither
 * — never to assert correctness — so the reciprocal case can't cause a false reject.
 */
function ratioCandidates(stem: string): number[] | null {
  if (!/\bratio\b|\bfor every\b|\bper\b/.test(stem)) return null;
  const rm = stem.match(/(\d+)\s*(?::|to|\/)\s*(\d+)/);
  if (!rm) return null;
  const a = Number(rm[1]); const b = Number(rm[2]);
  if (!a || !b) return null;
  const others = [...stem.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n !== a && n !== b);
  if (others.length !== 1) return null; // need exactly one given quantity to be safe
  const N = others[0];
  return [...new Set([(N * a) / b, (N * b) / a])];
}

// ---- convenience: blocking reasons for the gate/sweep ---------------------

export interface ItemCheck {
  resolve: ResolveResult;
  figure: FigureResult;
  /** true when the item should be BLOCKED (rejected / not validated / not imported) */
  block: boolean;
  reasons: string[];
}

export function checkItem(item: ResolvableItem): ItemCheck {
  const resolve = resolveItem(item);
  const figure = figureCompleteness(item.stem, item.figure);
  const reasons: string[] = [];
  if (resolve.verdict === 'mis_keyed') reasons.push(`mis-keyed (${resolve.family}): keyed option is not the computed answer`);
  if (resolve.verdict === 'no_correct_option') reasons.push(`no correct option (${resolve.family}): the computed answer matches none of the options`);
  if (resolve.verdict === 'ambiguous') reasons.push(`ambiguous (${resolve.family}): more than one option is defensibly correct`);
  if (figure.verdict === 'incomplete') reasons.push(`incomplete figure: ${figure.reason}`);
  if (figure.verdict === 'missing') reasons.push(`missing figure: ${figure.reason}`);
  const block = reasons.length > 0;
  return { resolve, figure, block, reasons };
}
