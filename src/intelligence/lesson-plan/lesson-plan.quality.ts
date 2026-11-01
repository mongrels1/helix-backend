/**
 * Lesson quality (Track LP4 + LP5): the week's arc, the four qualities that
 * make a plan worth teaching from, and a check on the answers.
 *
 *  - Arc (R2): every day is drafted in its own parallel call, so each one is
 *    told its place: class day k of n, its job (introduce / build / review /
 *    assess) and what the days either side of it are.
 *  - Qualities (R3): where_this_fits, watch_for (misconceptions), a worked
 *    example and practice with answers. Templates have no cells for these, so
 *    they go on a "Teacher notes" page the sidecar adds after the template.
 *  - Answers (R4): any "expression = value" the model writes is recomputed
 *    here; a mismatch is flagged in the notes rather than hidden.
 */
import { asText } from './lesson-plan.days';
import type { ResolvedDay } from './lesson-plan.days';

const NON_CLASS = new Set(['no_school', 'ild']);

export interface DayRole {
  position?: { k: number; n: number };
  role?: string;
  before?: string;
  after?: string;
}

function describe(r: ResolvedDay | undefined): string | undefined {
  if (!r) return undefined;
  const when = r.dateLabel ?? r.name;
  const what: Record<string, string> = {
    teach: 'a class day',
    ild: 'an independent learning day (no class session)',
    no_school: 'no school',
    test: 'an assessment day',
    centers: 'a centers / stations day',
    half_day: 'a half day',
  };
  return `${when} is ${what[r.status] ?? 'a class day'}${r.reason ? ` (${r.reason})` : ''}.`;
}

/** Each class day's place and job in the week. Non-class days get none. */
export function weekRoles(resolved: ResolvedDay[]): DayRole[] {
  const classIdx = resolved.map((r, i) => (NON_CLASS.has(r.status) ? -1 : i)).filter((i) => i >= 0);
  const n = classIdx.length;
  return resolved.map((r, i) => {
    if (NON_CLASS.has(r.status)) return {};
    const k = classIdx.indexOf(i) + 1;
    const nextClass = resolved.slice(i + 1).find((x) => !NON_CLASS.has(x.status));
    let role: string;
    if (r.status === 'test') role = 'assess what the week has taught';
    else if (nextClass?.status === 'test') role = `review and consolidate before the assessment on ${nextClass.dateLabel ?? nextClass.name}`;
    else if (k === 1) role = 'introduce the week\'s idea from concrete models';
    else if (k === n) role = 'apply the idea to a richer problem and check understanding';
    else role = 'build: move from models toward the rate/equation, with more independence';
    return { position: n > 1 ? { k, n } : undefined, role, before: describe(resolved[i - 1]), after: describe(resolved[i + 1]) };
  });
}

/* ------------------------------------------------------------------------- */
/*  Answer check (R4)                                                         */
/* ------------------------------------------------------------------------- */

/** Evaluate + - * / ( ) on numbers and simple fractions. Null if not purely arithmetic. */
export function evalArithmetic(expr: string): number | null {
  const src = expr.replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').trim();
  if (!/^[\d\s.+\-*/()]+$/.test(src) || !/\d/.test(src) || !/[+\-*/]/.test(src.replace(/^-/, ''))) return null;
  let i = 0;
  const peek = () => src[i];
  const skip = () => {
    while (src[i] === ' ') i++;
  };
  const num = (): number | null => {
    skip();
    if (peek() === '(') {
      i++;
      const v = add();
      skip();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      const v = num();
      return v === null ? null : -v;
    }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const mul = (): number | null => {
    let v = num();
    for (;;) {
      skip();
      const op = peek();
      if (op !== '*' && op !== '/') return v;
      i++;
      const r = num();
      if (v === null || r === null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
  };
  const add = (): number | null => {
    let v = mul();
    for (;;) {
      skip();
      const op = peek();
      if (op !== '+' && op !== '-') return v;
      i++;
      const r = mul();
      if (v === null || r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
  };
  const v = add();
  skip();
  return i === src.length && v !== null && Number.isFinite(v) ? v : null;
}

function parseValue(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  const n = /^-?\d+(?:\.\d+)?/.exec(t);
  return n ? Number(n[0]) : null;
}

/**
 * Every "a op b … = value" in a text, recomputed. Returns a line for each
 * equation that does not hold (to two decimal places, allowing rounding).
 */
export function checkArithmetic(text: string): string[] {
  const out: string[] = [];
  const re = /((?:\(?-?\d[\d.,]*\)?\s*[+\-−×x*/÷]\s*)+\(?-?\d[\d.,]*\)?)\s*=\s*(-?\d[\d.,]*(?:\s*\/\s*\d+)?)/g;
  for (const m of text.matchAll(re)) {
    // "12 × 20 = 8 × x" or "24/6 = 60/x" is an equation with an unknown, not
    // a claimed result: the number after "=" is followed by an operator or a
    // letter. Skip it (four false "Check:" lines on the Nov 9-13 plan).
    const after = text.slice((m.index ?? 0) + m[0].length);
    // An operator, or a single-letter unknown ("x", "8x"), not a unit word ("cups").
    if (/^\s*([×*/÷+\-−(]|[a-z](?![a-z]))/i.test(after)) continue;
    // Likewise when the left side continues an expression ("y + 3 × 4 = ...").
    const before = text.slice(0, m.index ?? 0);
    if (/[×*/÷+\-−]\s*$/.test(before)) continue;
    const lhs = evalArithmetic(m[1]);
    const rhs = parseValue(m[2]);
    if (lhs === null || rhs === null) continue;
    const tol = Math.max(0.006, Math.abs(lhs) * 0.005);
    if (Math.abs(lhs - rhs) > tol) {
      out.push(`${m[1].trim()} = ${m[2].trim()} (we get ${Number(lhs.toFixed(4))})`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/*  Unit facts (LP11)                                                         */
/* ------------------------------------------------------------------------- */

/** Smaller units per larger unit. */
const UNIT_FACTS: [RegExp, RegExp, number][] = [
  [/^(ounces?|oz)$/i, /^(pounds?|lbs?)$/i, 16],
  [/^(inch|inches|in)$/i, /^(foot|feet|ft)$/i, 12],
  [/^(foot|feet|ft)$/i, /^(yards?|yd)$/i, 3],
  [/^(inch|inches)$/i, /^(yards?)$/i, 36],
  [/^(minutes?|min)$/i, /^(hours?|hr)$/i, 60],
  [/^(seconds?|sec)$/i, /^(minutes?|min)$/i, 60],
  [/^(cups?)$/i, /^(pints?)$/i, 2],
  [/^(pints?)$/i, /^(quarts?)$/i, 2],
  [/^(quarts?)$/i, /^(gallons?)$/i, 4],
  [/^(cups?)$/i, /^(quarts?)$/i, 4],
  [/^(cups?)$/i, /^(gallons?)$/i, 16],
  [/^(centimeters?|cm)$/i, /^(meters?|m)$/i, 100],
  [/^(millimeters?|mm)$/i, /^(centimeters?|cm)$/i, 10],
  [/^(grams?|g)$/i, /^(kilograms?|kg)$/i, 1000],
  [/^(days?)$/i, /^(weeks?)$/i, 7],
];

const NUM = String.raw`(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)`;
const UNIT = String.raw`([a-z]+)`;
const PAIR = new RegExp(String.raw`${NUM}\s*${UNIT}\s*(?:=|equals?|is|are|makes?|→|->|,|to)\s*${NUM}\s*${UNIT}`, 'gi');

/** "2 ounces = 1 pound" and the like, checked against standard conversions. */
export function checkUnitFacts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PAIR)) {
    const [whole, a, ua, b, ub] = m;
    const va = parseValue(a);
    const vb = parseValue(b);
    if (va === null || vb === null || va === 0 || vb === 0) continue;
    for (const [small, big, k] of UNIT_FACTS) {
      let ok: boolean | null = null;
      if (small.test(ua) && big.test(ub)) ok = Math.abs(va / vb - k) <= k * 0.005;
      else if (big.test(ua) && small.test(ub)) ok = Math.abs(vb / va - k) <= k * 0.005;
      if (ok === false) out.push(`${whole.trim()} (wrong unit fact)`);
      if (ok !== null) break;
    }
  }
  return out;
}

/** A source the model marked as its own variation, not the teacher's resource. */
export function isAdapted(source: string): boolean {
  return /\badapt(ed|ation)?\b|\binspired by\b|\bbased on\b/i.test(source);
}

/* ------------------------------------------------------------------------- */
/*  Day normalisation and teacher notes (R3)                                  */
/* ------------------------------------------------------------------------- */

export interface TeacherNotes {
  where_this_fits: string;
  watch_for: { misconception: string; looks_like: string; teacher_response: string }[];
  worked_example: { problem: string; solution: string; source?: string } | null;
  practice: { problem: string; answer: string; source?: string }[];
  /** Answers that did not recompute; shown to the teacher, never hidden. */
  checks: string[];
}

function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return [v];
  return [];
}

function field(o: unknown, ...keys: string[]): string {
  if (!o || typeof o !== 'object') return asText(o);
  const r = o as Record<string, unknown>;
  for (const k of keys) {
    const t = asText(r[k]);
    if (t) return t;
  }
  return '';
}

/**
 * Shape a drafted class day for the template and the notes page:
 *  - the day-level vocabulary and writing move are copied into every segment
 *    (the template has a cell per segment; the model writes them once);
 *  - the four qualities are collected into `teacher_notes`;
 *  - answers are recomputed.
 */
export function normaliseClassDay(day: Record<string, unknown>): Record<string, unknown> {
  const vocab = asText(day.academic_vocabulary);
  const writing = asText(day.writing_strategies);
  const segments = list(day.segments).map((s) => {
    const seg = { ...(s as Record<string, unknown>) };
    if (!asText(seg.academic_vocabulary) && vocab) seg.academic_vocabulary = vocab;
    if (!asText(seg.writing_strategies) && writing) seg.writing_strategies = writing;
    return seg;
  });

  // LP11: a misconception sent as a plain string is the misconception only;
  // "Looks like" / "What to say" are printed only when they add something.
  const watch = list(day.watch_for)
    .map((w) => {
      if (!w || typeof w !== 'object') return { misconception: asText(w), looks_like: '', teacher_response: '' };
      const m = field(w, 'misconception', 'error', 'mistake');
      const extra = (t: string) => (t && t !== m ? t : '');
      return {
        misconception: m,
        looks_like: extra(field(w, 'looks_like', 'how_it_shows', 'example')),
        teacher_response: extra(field(w, 'teacher_response', 'response', 'what_to_do')),
      };
    })
    .filter((w) => w.misconception);

  const we = day.worked_example;
  const worked =
    we && typeof we === 'object'
      ? {
          problem: field(we, 'problem', 'question'),
          solution: field(we, 'solution', 'answer', 'steps'),
          source: field(we, 'source', 'from'),
        }
      : asText(we)
        ? { problem: asText(we), solution: '' }
        : null;

  const drafted = list(day.practice)
    .map((p) => ({
      problem: field(p, 'problem', 'question'),
      answer: field(p, 'answer', 'solution'),
      source: field(p, 'source', 'from'),
    }))
    .filter((p) => p.problem);

  // LP11: nothing wrong or invented reaches the page. A practice item is kept
  // only if its answer recomputes, its unit facts are right and it is not an
  // "adapted" (invented) item. A worked example that fails is replaced by the
  // first good practice item.
  const problems = (text: string) => [...checkArithmetic(text), ...checkUnitFacts(text)];
  const good = (src: string, text: string) => !isAdapted(src) && problems(text).length === 0;
  const practice = drafted.filter((p) => good(p.source, `${p.problem}\n${p.answer}`));
  const removed = drafted.length - practice.length;

  let workedOut = worked && (worked.problem || worked.solution) ? worked : null;
  if (workedOut && !good(workedOut.source ?? '', `${workedOut.problem}\n${workedOut.solution}`)) {
    const swap = practice.shift();
    workedOut = swap ? { problem: swap.problem, solution: swap.answer, source: swap.source } : null;
  }

  const checks: string[] = [];
  if (removed > 0) checks.push(`${removed} practice problem${removed > 1 ? 's' : ''} removed: wrong answer, wrong unit fact or not from your resources.`);

  const notes: TeacherNotes = {
    where_this_fits: asText(day.where_this_fits),
    watch_for: watch,
    worked_example: workedOut,
    practice,
    checks,
  };

  const out: Record<string, unknown> = { ...day, segments, teacher_notes: notes };
  delete out.watch_for;
  delete out.worked_example;
  delete out.practice;
  delete out.where_this_fits;
  return out;
}

/** ILD days: recheck the answer key too, and give the notes page a line. */
export function ildNotes(answerKey: string): TeacherNotes {
  return {
    where_this_fits: 'Independent learning day: students complete the assignment on their own. Review it at the start of the next class.',
    watch_for: [],
    worked_example: null,
    practice: [],
    checks: checkArithmetic(answerKey).map((c) => `Answer key: ${c}. Fix before handing out.`),
  };
}
