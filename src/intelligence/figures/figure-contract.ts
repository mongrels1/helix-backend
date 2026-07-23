// =============================================================================
// EdKairos — Canonical figure contract (backend source of truth)
// -----------------------------------------------------------------------------
// This is the ONE backend mirror of the frontend renderer's spec + validator
// (helix-frontend/src/components/figures/figure.ts). The frontend `parseFigure`
// SILENTLY returns null on any missing/invalid required field or unknown `type`,
// which makes a mis-shaped figure disappear into a blank placeholder. To stop
// that class of silent failure at the source, every backend write path and the
// admin editor validate against THIS module instead of re-declaring the figure
// shape locally (the previous item-models union, isAllowedFigure allow-list, and
// the prompt examples had all drifted out of sync).
//
// Keep `parseFigure` byte-for-byte faithful to the frontend: if the renderer
// would accept a spec, this must accept it, and vice-versa. Pure module, no deps.
// =============================================================================

/** Every renderable figure `type`, exactly as the frontend <FigureRenderer> switch. */
export const FIGURE_TYPES = [
  'number_line', 'fraction_bar', 'rect', 'spinner', 'bar_graph', 'triangle', 'angle',
  'coordinate_grid', 'dot_plot', 'histogram', 'place_value_chart', 'decimal_grid',
  'function_table', 'ratio_table', 'scatter_plot', 'right_triangle', 'cylinder', 'cone',
  'sphere', 'circle', 'transformation', 'ladder_wall', 'geogebra', 'geometry2d',
  'rect_prism', 'tri_prism', 'angle_pair',
] as const;

export type FigureType = (typeof FIGURE_TYPES)[number];

const RENDERABLE = new Set<string>(FIGURE_TYPES);

/** True when `t` is a figure type the renderer can draw. */
export function isRenderableFigureType(t: unknown): t is FigureType {
  return typeof t === 'string' && RENDERABLE.has(t);
}

export type Pt = { x: number; y: number };

/**
 * Permissive producer-facing union — the complete set of 27 renderable figures.
 * Enum-like fields (e.g. geometry2d.shape) are typed loosely as `string` so
 * deterministic producers (item-models) stay ergonomic; the STRICT enum check is
 * enforced at runtime by `parseFigure` at the write boundary. This is the single
 * `Figure` type the rest of the backend imports (re-exported by item-models/types).
 */
export type Figure =
  | { type: 'number_line'; min: number; max: number; ticks?: number; marks?: { at: number; label?: string }[]; jumps?: { from: number; to: number; label?: string }[]; altText?: string }
  | { type: 'fraction_bar'; whole: number; shaded: number; label?: string; altText?: string }
  | { type: 'rect'; w: number; h: number; unit?: string; mode?: 'area' | 'perimeter' | 'plain'; altText?: string }
  | { type: 'spinner'; sectors: { label: string; weight: number; color?: string }[]; altText?: string }
  | { type: 'bar_graph'; bars: { label: string; value: number }[]; unit?: string; altText?: string }
  | { type: 'triangle'; base: number; height: number; unit?: string; mode?: 'area' | 'plain'; altText?: string }
  | { type: 'angle'; degrees: number; label?: string; altText?: string }
  | { type: 'coordinate_grid'; min: number; max: number; points: { x: number; y: number; label?: string }[]; line?: { m: number; b: number } | { from: Pt; to: Pt }; altText?: string }
  | { type: 'dot_plot'; min: number; max: number; values: number[]; label?: string; altText?: string }
  | { type: 'histogram'; bins: { label: string; count: number }[]; unit?: string; altText?: string }
  | { type: 'place_value_chart'; value: number; highlight?: string[]; altText?: string }
  | { type: 'decimal_grid'; value: number; label?: string; altText?: string }
  | { type: 'function_table'; rule?: string; rows: { in: number | string; out: number | string }[]; headers?: [string, string]; altText?: string }
  | { type: 'ratio_table'; headers: [string, string]; rows: { a: number | string; b: number | string }[]; altText?: string }
  | { type: 'scatter_plot'; points: Pt[]; xLabel?: string; yLabel?: string; line?: { m: number; b: number }; altText?: string }
  | { type: 'right_triangle'; a: number; b: number; labelA?: string; labelB?: string; labelC?: string; altText?: string }
  | { type: 'cylinder'; r: number; h: number; rLabel?: string; hLabel?: string; altText?: string }
  | { type: 'cone'; r: number; h: number; rLabel?: string; hLabel?: string; altText?: string }
  | { type: 'sphere'; r: number; rLabel?: string; altText?: string }
  | { type: 'circle'; r: number; show?: 'radius' | 'diameter'; label?: string; altText?: string }
  | { type: 'transformation'; min: number; max: number; preimage: Pt[]; image: Pt[]; kind?: 'translation' | 'reflection' | 'rotation' | 'dilation'; showImage?: boolean; note?: string; altText?: string }
  | { type: 'ladder_wall'; base: number; height: number; baseLabel?: string; heightLabel?: string; hypLabel?: string; altText?: string }
  | { type: 'geogebra'; appName?: 'graphing' | 'geometry' | 'classic' | 'suite'; commands: string[]; altText?: string }
  | { type: 'geometry2d'; shape: string; symmetry?: boolean; caption?: string; altText?: string }
  | { type: 'rect_prism'; l: number; w: number; h: number; lLabel?: string; wLabel?: string; hLabel?: string; altText?: string }
  | { type: 'tri_prism'; b: number; h: number; len: number; bLabel?: string; hLabel?: string; lenLabel?: string; altText?: string }
  | { type: 'angle_pair'; kind: 'complementary' | 'supplementary' | 'vertical'; known: number; knownLabel?: string; unknownLabel?: string; altText?: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const anyStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : v !== undefined && v !== null ? String(v) : undefined);

const GEOMETRY2D_SHAPES = [
  'square', 'rectangle', 'rhombus', 'parallelogram', 'trapezoid', 'kite',
  'triangle_equilateral', 'triangle_isosceles', 'triangle_scalene', 'triangle_right',
  'pentagon', 'hexagon', 'octagon',
  'parallel_lines', 'perpendicular_lines', 'intersecting_lines', 'rays',
];

/**
 * Tolerant validator — a faithful port of the frontend renderer's parseFigure.
 * Accepts a Figure object OR a JSON string. Returns a normalized Figure, or null
 * if the spec is missing/invalid. Extra fields are ignored (NOT rejected). Any
 * spec this returns non-null for is guaranteed to render; any it returns null for
 * would show as a blank placeholder in the app.
 */
export function parseFigure(input: unknown): Figure | null {
  if (input == null) return null;

  let raw: unknown = input;
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;
    try { raw = JSON.parse(s); } catch { return null; }
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const f = raw as Record<string, unknown>;
  switch (f.type) {
    case 'number_line':
      if (!isNum(f.min) || !isNum(f.max) || f.max <= f.min) return null;
      return {
        type: 'number_line',
        min: f.min, max: f.max,
        ticks: isNum(f.ticks) && f.ticks > 0 ? f.ticks : undefined,
        marks: Array.isArray(f.marks)
          ? f.marks.filter((m: any) => isNum(m?.at)).map((m: any) => ({ at: m.at, label: str(m.label) }))
          : undefined,
        jumps: Array.isArray(f.jumps)
          ? f.jumps.filter((j: any) => isNum(j?.from) && isNum(j?.to)).map((j: any) => ({ from: j.from, to: j.to, label: str(j.label) }))
          : undefined,
        altText: str(f.altText),
      };

    case 'fraction_bar':
      if (!isNum(f.whole) || f.whole < 1) return null;
      return {
        type: 'fraction_bar',
        whole: Math.round(f.whole),
        shaded: Math.max(0, Math.min(Math.round((f.shaded as number) || 0), Math.round(f.whole))),
        label: str(f.label), altText: str(f.altText),
      };

    case 'rect':
      if (!isNum(f.w) || !isNum(f.h) || f.w < 1 || f.h < 1) return null;
      return {
        type: 'rect', w: Math.round(f.w), h: Math.round(f.h),
        unit: str(f.unit),
        mode: (['area', 'perimeter', 'plain'] as const).includes(f.mode as any) ? (f.mode as any) : undefined,
        altText: str(f.altText),
      };

    case 'spinner': {
      if (!Array.isArray(f.sectors)) return null;
      const sectors = f.sectors
        .filter((s: any) => typeof s?.label === 'string' && isNum(s?.weight) && s.weight > 0)
        .map((s: any) => ({ label: s.label, weight: s.weight, color: str(s.color) }));
      if (sectors.length === 0) return null;
      return { type: 'spinner', sectors, altText: str(f.altText) };
    }

    case 'bar_graph': {
      if (!Array.isArray(f.bars)) return null;
      const bars = f.bars
        .filter((b: any) => typeof b?.label === 'string' && isNum(b?.value))
        .map((b: any) => ({ label: b.label, value: b.value }));
      if (bars.length === 0) return null;
      return { type: 'bar_graph', bars, unit: str(f.unit), altText: str(f.altText) };
    }

    case 'triangle':
      if (!isNum(f.base) || !isNum(f.height) || f.base <= 0 || f.height <= 0) return null;
      return {
        type: 'triangle', base: f.base, height: f.height,
        unit: str(f.unit),
        mode: (['area', 'plain'] as const).includes(f.mode as any) ? (f.mode as any) : undefined,
        altText: str(f.altText),
      };

    case 'angle':
      if (!isNum(f.degrees) || f.degrees <= 0 || f.degrees >= 360) return null;
      return { type: 'angle', degrees: f.degrees, label: str(f.label), altText: str(f.altText) };

    case 'coordinate_grid': {
      const pts = Array.isArray(f.points)
        ? f.points.filter((p: any) => isNum(p?.x) && isNum(p?.y)).map((p: any) => ({ x: p.x, y: p.y, label: str(p.label) }))
        : [];
      let line: any;
      const L = f.line as any;
      if (L && isNum(L.m) && isNum(L.b)) line = { m: L.m, b: L.b };
      else if (L && isNum(L.from?.x) && isNum(L.from?.y) && isNum(L.to?.x) && isNum(L.to?.y)) line = { from: { x: L.from.x, y: L.from.y }, to: { x: L.to.x, y: L.to.y } };
      return {
        type: 'coordinate_grid',
        min: isNum(f.min) ? f.min : -5, max: isNum(f.max) ? f.max : 5,
        points: pts, line, altText: str(f.altText),
      };
    }

    case 'dot_plot': {
      if (!isNum(f.min) || !isNum(f.max) || f.max <= f.min) return null;
      const values = Array.isArray(f.values) ? f.values.filter(isNum) : [];
      if (values.length === 0) return null;
      return { type: 'dot_plot', min: f.min, max: f.max, values, label: str(f.label), altText: str(f.altText) };
    }

    case 'histogram': {
      if (!Array.isArray(f.bins)) return null;
      const bins = f.bins.filter((b: any) => typeof b?.label === 'string' && isNum(b?.count)).map((b: any) => ({ label: b.label, count: b.count }));
      if (bins.length === 0) return null;
      return { type: 'histogram', bins, unit: str(f.unit), altText: str(f.altText) };
    }

    case 'place_value_chart':
      if (!isNum(f.value)) return null;
      return { type: 'place_value_chart', value: Math.abs(Math.trunc(f.value)), highlight: Array.isArray(f.highlight) ? f.highlight.filter((h: any) => typeof h === 'string') : undefined, altText: str(f.altText) };

    case 'decimal_grid':
      if (!isNum(f.value)) return null;
      return { type: 'decimal_grid', value: Math.max(0, Math.min(1, f.value)), label: str(f.label), altText: str(f.altText) };

    case 'function_table': {
      if (!Array.isArray(f.rows)) return null;
      const rows = f.rows.filter((r: any) => r && r.in !== undefined && r.out !== undefined).map((r: any) => ({ in: r.in, out: r.out }));
      if (rows.length === 0) return null;
      return { type: 'function_table', rule: str(f.rule), rows, headers: Array.isArray(f.headers) && f.headers.length === 2 ? [String(f.headers[0]), String(f.headers[1])] : undefined, altText: str(f.altText) };
    }

    case 'ratio_table': {
      if (!Array.isArray(f.rows) || !Array.isArray(f.headers) || f.headers.length !== 2) return null;
      const rows = f.rows.filter((r: any) => r && r.a !== undefined && r.b !== undefined).map((r: any) => ({ a: r.a, b: r.b }));
      if (rows.length === 0) return null;
      return { type: 'ratio_table', headers: [String(f.headers[0]), String(f.headers[1])], rows, altText: str(f.altText) };
    }

    case 'scatter_plot': {
      const points = Array.isArray(f.points)
        ? f.points.filter((p: any) => isNum(p?.x) && isNum(p?.y)).map((p: any) => ({ x: p.x, y: p.y }))
        : [];
      if (points.length < 2) return null;
      let line: { m: number; b: number } | undefined;
      const L = f.line as any;
      if (L && isNum(L.m) && isNum(L.b)) line = { m: L.m, b: L.b };
      return { type: 'scatter_plot', points, line, xLabel: str(f.xLabel), yLabel: str(f.yLabel), altText: str(f.altText) };
    }

    case 'right_triangle':
      if (!isNum(f.a) || !isNum(f.b) || f.a <= 0 || f.b <= 0) return null;
      return {
        type: 'right_triangle', a: f.a, b: f.b,
        labelA: anyStr(f.labelA), labelB: anyStr(f.labelB), labelC: anyStr(f.labelC),
        altText: str(f.altText),
      };

    case 'cylinder':
      if (!isNum(f.r) || !isNum(f.h) || f.r <= 0 || f.h <= 0) return null;
      return { type: 'cylinder', r: f.r, h: f.h, rLabel: str(f.rLabel), hLabel: str(f.hLabel), altText: str(f.altText) };

    case 'cone':
      if (!isNum(f.r) || !isNum(f.h) || f.r <= 0 || f.h <= 0) return null;
      return { type: 'cone', r: f.r, h: f.h, rLabel: str(f.rLabel), hLabel: str(f.hLabel), altText: str(f.altText) };

    case 'sphere':
      if (!isNum(f.r) || f.r <= 0) return null;
      return { type: 'sphere', r: f.r, rLabel: str(f.rLabel), altText: str(f.altText) };

    case 'circle':
      if (!isNum(f.r) || f.r <= 0) return null;
      return {
        type: 'circle', r: f.r,
        show: (['radius', 'diameter'] as const).includes(f.show as any) ? (f.show as any) : undefined,
        label: str(f.label), altText: str(f.altText),
      };

    case 'ladder_wall':
      if (!isNum(f.base) || !isNum(f.height) || f.base <= 0 || f.height <= 0) return null;
      return {
        type: 'ladder_wall', base: f.base, height: f.height,
        baseLabel: str(f.baseLabel), heightLabel: str(f.heightLabel), hypLabel: str(f.hypLabel),
        altText: str(f.altText),
      };

    case 'transformation': {
      const clean = (arr: unknown) =>
        Array.isArray(arr)
          ? arr.filter((p: any) => isNum(p?.x) && isNum(p?.y)).map((p: any) => ({ x: p.x, y: p.y }))
          : [];
      const preimage = clean(f.preimage);
      const image = clean(f.image);
      if (preimage.length < 2 || image.length < 2) return null;
      return {
        type: 'transformation',
        min: isNum(f.min) ? f.min : -10, max: isNum(f.max) ? f.max : 10,
        preimage, image,
        kind: (['translation', 'reflection', 'rotation', 'dilation'] as const).includes(f.kind as any) ? (f.kind as any) : undefined,
        showImage: f.showImage === false ? false : undefined,
        note: str(f.note), altText: str(f.altText),
      };
    }

    case 'geogebra': {
      if (!Array.isArray(f.commands) || f.commands.some((c: any) => typeof c !== 'string')) return null;
      return {
        type: 'geogebra',
        appName: (['graphing', 'geometry', 'classic', 'suite'] as const).includes(f.appName as any) ? (f.appName as any) : 'graphing',
        commands: f.commands as string[],
        altText: str(f.altText),
      };
    }

    case 'geometry2d':
      if (typeof f.shape !== 'string' || !GEOMETRY2D_SHAPES.includes(f.shape)) return null;
      return {
        type: 'geometry2d', shape: f.shape,
        symmetry: f.symmetry === true ? true : undefined,
        caption: str(f.caption), altText: str(f.altText),
      };

    case 'rect_prism':
      if (!isNum(f.l) || !isNum(f.w) || !isNum(f.h) || f.l <= 0 || f.w <= 0 || f.h <= 0) return null;
      return {
        type: 'rect_prism', l: f.l, w: f.w, h: f.h,
        lLabel: anyStr(f.lLabel), wLabel: anyStr(f.wLabel), hLabel: anyStr(f.hLabel),
        altText: str(f.altText),
      };

    case 'tri_prism':
      if (!isNum(f.b) || !isNum(f.h) || !isNum(f.len) || f.b <= 0 || f.h <= 0 || f.len <= 0) return null;
      return {
        type: 'tri_prism', b: f.b, h: f.h, len: f.len,
        bLabel: anyStr(f.bLabel), hLabel: anyStr(f.hLabel), lenLabel: anyStr(f.lenLabel),
        altText: str(f.altText),
      };

    case 'angle_pair': {
      const kinds = ['complementary', 'supplementary', 'vertical'] as const;
      if (!kinds.includes(f.kind as any) || !isNum(f.known)) return null;
      const max = f.kind === 'complementary' ? 90 : 180;
      if (f.known <= 0 || f.known >= max) return null;
      return {
        type: 'angle_pair', kind: f.kind as 'complementary' | 'supplementary' | 'vertical', known: f.known,
        knownLabel: str(f.knownLabel), unknownLabel: str(f.unknownLabel), altText: str(f.altText),
      };
    }

    default:
      return null;
  }
}

export interface FigureValidation { ok: boolean; type: string | null; error?: string }

/**
 * Boundary verifier used by every write path (generation, import, the admin
 * figure editor, the Verify-Database sweep) and by the item judge. `ok` is true
 * only when the spec will actually render. On failure it names why so callers can
 * repair, strip, or reject rather than silently ship a blank.
 */
export function validateFigure(input: unknown): FigureValidation {
  if (input == null) return { ok: false, type: null, error: 'no figure' };
  let raw: unknown = input;
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return { ok: false, type: null, error: 'empty figure string' };
    try { raw = JSON.parse(s); } catch { return { ok: false, type: null, error: 'unparseable figure JSON' }; }
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, type: null, error: 'figure is not an object' };
  const t = (raw as { type?: unknown }).type;
  const type = typeof t === 'string' ? t : null;
  if (!isRenderableFigureType(t)) {
    return { ok: false, type, error: type ? `unknown figure type "${type}"` : 'figure has no type' };
  }
  if (parseFigure(raw) == null) {
    return { ok: false, type, error: `"${type}" figure is missing or has invalid required fields` };
  }
  return { ok: true, type };
}

/** Convenience predicate — true only when the spec will render. */
export function isRenderableFigure(input: unknown): boolean {
  return validateFigure(input).ok;
}
