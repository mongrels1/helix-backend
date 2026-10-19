/**
 * Live whiteboard: the pure rules. No Nest, no Prisma, no sockets — so every
 * permission and every merge decision is unit-tested in isolation
 * (whiteboard.logic.spec.ts).
 *
 * Sync model. A board is a set of immutable strokes, each with a client-made id.
 * Operations are "add this stroke", "remove these ids" and "clear". Two students
 * drawing at the same moment add two different strokes, so nothing is ever
 * overwritten and no merge is needed. Adding an id that already exists is a no-op,
 * so a client that reconnects and resends its queue cannot duplicate work.
 */

export const BOARD_KIND = { GROUP: 'GROUP', PRIVATE: 'PRIVATE' } as const;
export type BoardKind = (typeof BOARD_KIND)[keyof typeof BOARD_KIND];

export const SESSION_MODE = {
  MONITOR: 'MONITOR',
  GROUP: 'GROUP',
  ONE_ON_ONE: 'ONE_ON_ONE',
} as const;
export type SessionMode = (typeof SESSION_MODE)[keyof typeof SESSION_MODE];

export const STROKE_TOOLS = [
  'pen',
  'highlighter',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'grid',
  'numberline',
] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];

/** Where a stroke lives: 'q' = on the question itself, 'p:<pageId>' = a board page. */
export type Layer = string;

export interface Stroke {
  id: string;
  authorId: string;
  layer: Layer;
  tool: StrokeTool;
  color: string;
  width: number;
  /** Flat [x0, y0, x1, y1, ...] in the layer's logical units (never screen pixels). */
  points: number[];
  text?: string;
  /** Tool-specific numbers: grid {cols, rows}, numberline {min, max, step}. */
  meta?: Record<string, number>;
  t: number;
}

export interface BoardPage {
  id: string;
}

export interface BoardDoc {
  pages: BoardPage[];
  strokes: Stroke[];
}

export type BoardOp =
  | { type: 'add'; stroke: Stroke }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear'; layer: Layer; scope: 'mine' | 'all' }
  | { type: 'addPage'; page: BoardPage };

export interface SessionState {
  tutorId: string;
  status: string;
  mode: string;
  focusStudentId: string | null;
  presentedBoardId: string | null;
  lockedStudentIds: string[];
}

export interface BoardRef {
  id: string;
  kind: string;
  ownerId: string | null;
}

// ---- limits ------------------------------------------------------------------

export const LIMITS = {
  maxPointsPerStroke: 2000, // numbers, i.e. 1000 x/y pairs
  maxStrokesPerBoard: 3000,
  /** Total point numbers on one board (about 2.5 MB of JSON at most). */
  maxPointsPerBoard: 200_000,
  maxPages: 20,
  maxText: 500,
  maxIdLength: 64,
  logicalMax: 20000,
} as const;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const LAYER_RE = /^(q|p:[A-Za-z0-9_-]{1,64})$/;

export function emptyDoc(): BoardDoc {
  return { pages: [{ id: 'page1' }], strokes: [] };
}

/** Accept whatever is stored in the JSON column and return a well-formed doc. */
export function normalizeDoc(raw: unknown): BoardDoc {
  const doc = (raw ?? {}) as Partial<BoardDoc>;
  const pages = Array.isArray(doc.pages) && doc.pages.length > 0 ? doc.pages : [{ id: 'page1' }];
  const strokes = Array.isArray(doc.strokes) ? doc.strokes : [];
  return { pages: pages.map((p) => ({ id: String(p.id) })), strokes };
}

// ---- permissions -------------------------------------------------------------

export function isTutor(userId: string, s: SessionState): boolean {
  return userId === s.tutorId;
}

/** Can this user see the board (and receive its live strokes)? */
export function canView(userId: string, s: SessionState, b: BoardRef): boolean {
  if (isTutor(userId, s)) return true;
  if (b.kind === BOARD_KIND.GROUP) return true;
  if (b.kind === BOARD_KIND.PRIVATE && b.ownerId === userId) return true;
  // A private board the tutor has put on the group screen is visible read-only.
  return s.presentedBoardId === b.id;
}

/** Can this user write on the board right now? */
export function canWrite(userId: string, s: SessionState, b: BoardRef): boolean {
  if (s.status !== 'ACTIVE') return false;
  if (isTutor(userId, s)) return true;
  if (s.lockedStudentIds.includes(userId)) return false;
  if (b.kind === BOARD_KIND.PRIVATE) return b.ownerId === userId;
  // The shared board is open to students only while the tutor runs group mode.
  if (b.kind === BOARD_KIND.GROUP) return s.mode === SESSION_MODE.GROUP;
  return false;
}

// ---- validation --------------------------------------------------------------

export class OpError extends Error {}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Validate a stroke from a client and return a clean copy stamped with the real author. */
export function sanitizeStroke(input: unknown, authorId: string, now = Date.now()): Stroke {
  const s = (input ?? {}) as Partial<Stroke>;
  if (typeof s.id !== 'string' || !ID_RE.test(s.id)) throw new OpError('bad stroke id');
  if (typeof s.layer !== 'string' || !LAYER_RE.test(s.layer)) throw new OpError('bad layer');
  if (!STROKE_TOOLS.includes(s.tool as StrokeTool)) throw new OpError('bad tool');
  if (typeof s.color !== 'string' || !COLOR_RE.test(s.color)) throw new OpError('bad color');
  if (!finite(s.width) || s.width <= 0 || s.width > 80) throw new OpError('bad width');
  if (!Array.isArray(s.points) || s.points.length < 2 || s.points.length % 2 !== 0) {
    throw new OpError('bad points');
  }
  if (s.points.length > LIMITS.maxPointsPerStroke) throw new OpError('stroke too long');
  const points = s.points.map((p) => {
    if (!finite(p) || Math.abs(p) > LIMITS.logicalMax) throw new OpError('bad point');
    return Math.round(p * 10) / 10;
  });
  const clean: Stroke = {
    id: s.id,
    authorId, // never trust the client's claim about who drew it
    layer: s.layer,
    tool: s.tool as StrokeTool,
    color: s.color,
    width: Math.round(s.width * 10) / 10,
    points,
    t: now,
  };
  if (s.tool === 'text') {
    if (typeof s.text !== 'string' || s.text.trim() === '') throw new OpError('empty text');
    clean.text = s.text.slice(0, LIMITS.maxText);
  }
  if (s.meta && typeof s.meta === 'object') {
    const meta: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.meta).slice(0, 8)) {
      if (/^[a-z]{1,12}$/i.test(k) && finite(v) && Math.abs(v) <= 10000) meta[k] = v;
    }
    clean.meta = meta;
  }
  return clean;
}

/** Validate an op from a client. Throws OpError on anything malformed. */
export function sanitizeOp(input: unknown, authorId: string, now = Date.now()): BoardOp {
  const op = (input ?? {}) as { type?: string } & Record<string, unknown>;
  switch (op.type) {
    case 'add':
      return { type: 'add', stroke: sanitizeStroke(op.stroke, authorId, now) };
    case 'remove': {
      const ids = op.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw new OpError('bad ids');
      if (!ids.every((id) => typeof id === 'string' && ID_RE.test(id))) throw new OpError('bad id');
      return { type: 'remove', ids: ids as string[] };
    }
    case 'clear': {
      if (typeof op.layer !== 'string' || !LAYER_RE.test(op.layer)) throw new OpError('bad layer');
      const scope = op.scope === 'all' ? 'all' : 'mine';
      return { type: 'clear', layer: op.layer, scope };
    }
    case 'addPage': {
      const page = op.page as BoardPage | undefined;
      if (!page || typeof page.id !== 'string' || !ID_RE.test(page.id)) throw new OpError('bad page');
      return { type: 'addPage', page: { id: page.id } };
    }
    default:
      throw new OpError('unknown op');
  }
}

// ---- applying ops ------------------------------------------------------------

export interface ApplyResult {
  /** The op as it should be broadcast (a remove/clear lists the ids actually removed). */
  applied: BoardOp | null;
  changed: boolean;
}

/**
 * Apply one op to the doc in place. Students may only remove or clear their own
 * strokes; the tutor may remove anyone's (e.g. to tidy the group board).
 */
export function applyOp(doc: BoardDoc, op: BoardOp, userId: string, tutor: boolean): ApplyResult {
  switch (op.type) {
    case 'add': {
      if (doc.strokes.some((s) => s.id === op.stroke.id)) return { applied: null, changed: false };
      if (doc.strokes.length >= LIMITS.maxStrokesPerBoard) throw new OpError('board is full');
      if (op.stroke.layer.startsWith('p:') && !doc.pages.some((p) => `p:${p.id}` === op.stroke.layer)) {
        throw new OpError('no such page');
      }
      doc.strokes.push(op.stroke);
      return { applied: op, changed: true };
    }
    case 'remove': {
      const wanted = new Set(op.ids);
      const removed: string[] = [];
      doc.strokes = doc.strokes.filter((s) => {
        if (!wanted.has(s.id)) return true;
        if (!tutor && s.authorId !== userId) return true;
        removed.push(s.id);
        return false;
      });
      if (removed.length === 0) return { applied: null, changed: false };
      return { applied: { type: 'remove', ids: removed }, changed: true };
    }
    case 'clear': {
      const everyone = op.scope === 'all' && tutor;
      const removed: string[] = [];
      doc.strokes = doc.strokes.filter((s) => {
        if (s.layer !== op.layer) return true;
        if (!everyone && s.authorId !== userId) return true;
        removed.push(s.id);
        return false;
      });
      if (removed.length === 0) return { applied: null, changed: false };
      return { applied: { type: 'remove', ids: removed }, changed: true };
    }
    case 'addPage': {
      if (doc.pages.some((p) => p.id === op.page.id)) return { applied: null, changed: false };
      if (doc.pages.length >= LIMITS.maxPages) throw new OpError('too many pages');
      doc.pages.push(op.page);
      return { applied: op, changed: true };
    }
  }
}

// ---- questions ---------------------------------------------------------------

export interface BoardQuestion {
  source: 'bank' | 'custom';
  itemId?: string;
  label?: string;
  stem: string;
  options?: string[];
  figure?: unknown;
  imageUrl?: string;
}

/** Clean a question coming from the tutor (custom text or an item copied from the bank). */
export function sanitizeQuestion(input: unknown): BoardQuestion | null {
  if (input === null || input === undefined) return null;
  const q = input as Partial<BoardQuestion>;
  if (typeof q.stem !== 'string' || q.stem.trim() === '') throw new OpError('question needs text');
  const out: BoardQuestion = {
    source: q.source === 'bank' ? 'bank' : 'custom',
    stem: q.stem.slice(0, 4000),
  };
  if (typeof q.itemId === 'string') out.itemId = q.itemId.slice(0, 64);
  if (typeof q.label === 'string') out.label = q.label.slice(0, 120);
  if (Array.isArray(q.options)) {
    out.options = q.options.filter((o) => typeof o === 'string').slice(0, 8).map((o) => o.slice(0, 400));
  }
  if (q.figure !== undefined && q.figure !== null) {
    const size = JSON.stringify(q.figure).length;
    if (size > 50_000) throw new OpError('figure too large');
    out.figure = q.figure;
  }
  if (typeof q.imageUrl === 'string' && isOwnImageHost(q.imageUrl)) {
    out.imageUrl = q.imageUrl;
  }
  return out;
}

/** Fixed, distinct ink colors so every participant's work is identifiable. */
export const TUTOR_COLOR = '#007a00';
export const STUDENT_COLORS = [
  '#1d4ed8',
  '#c2410c',
  '#7e22ce',
  '#0f766e',
  '#be185d',
  '#4d7c0f',
  '#b45309',
  '#0369a1',
  '#9f1239',
  '#4338ca',
  '#a16207',
  '#155e75',
];

/**
 * Pictures on a question may only come from EdKairos's own hosts, so a child's
 * browser is never pointed at a third-party server by a pasted link.
 */
export function isOwnImageHost(url: string): boolean {
  if (url.length > 1000 || /[\s"'<>]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'edkairos.com' || u.hostname.endsWith('.edkairos.com'));
  } catch {
    return false;
  }
}

/** A small token bucket: `rate` events per second, bursts up to `burst`. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(
    private readonly rate: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
  }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
