import {
  applyOp,
  BoardRef,
  canView,
  canWrite,
  emptyDoc,
  inkFor,
  isOwnImageHost,
  OpError,
  RateLimiter,
  sanitizeOp,
  sanitizeQuestion,
  sanitizeStroke,
  uploadQuestion,
  SessionState,
} from './whiteboard.logic';

const TUTOR = 'tutor-1';
const MAYA = 'maya';
const JAY = 'jayden';

function session(over: Partial<SessionState> = {}): SessionState {
  return {
    tutorId: TUTOR,
    status: 'ACTIVE',
    mode: 'MONITOR',
    focusStudentId: null,
    presentedBoardId: null,
    lockedStudentIds: [],
    ...over,
  };
}

const group: BoardRef = { id: 'g', kind: 'GROUP', ownerId: null };
const mayaBoard: BoardRef = { id: 'bm', kind: 'PRIVATE', ownerId: MAYA };

function stroke(id: string, layer = 'p:page1') {
  return { id, layer, tool: 'pen', color: '#1d4ed8', width: 3, points: [1, 2, 3, 4] };
}

describe('whiteboard permissions', () => {
  it('keeps a private board private to its owner and the tutor', () => {
    const s = session();
    expect(canView(MAYA, s, mayaBoard)).toBe(true);
    expect(canView(TUTOR, s, mayaBoard)).toBe(true);
    expect(canView(JAY, s, mayaBoard)).toBe(false);
  });

  it('shows a presented private board to classmates, read-only', () => {
    const s = session({ presentedBoardId: 'bm', mode: 'GROUP' });
    expect(canView(JAY, s, mayaBoard)).toBe(true);
    expect(canWrite(JAY, s, mayaBoard)).toBe(false);
    expect(canWrite(MAYA, s, mayaBoard)).toBe(true);
  });

  it('opens the group board to students only in group mode', () => {
    expect(canWrite(JAY, session({ mode: 'MONITOR' }), group)).toBe(false);
    expect(canWrite(JAY, session({ mode: 'GROUP' }), group)).toBe(true);
    expect(canWrite(TUTOR, session({ mode: 'MONITOR' }), group)).toBe(true);
  });

  it('a locked student can read but not write anywhere', () => {
    const s = session({ mode: 'GROUP', lockedStudentIds: [MAYA] });
    expect(canWrite(MAYA, s, mayaBoard)).toBe(false);
    expect(canWrite(MAYA, s, group)).toBe(false);
    expect(canView(MAYA, s, mayaBoard)).toBe(true);
  });

  it('nobody writes after the session ends', () => {
    const s = session({ status: 'ENDED' });
    expect(canWrite(TUTOR, s, group)).toBe(false);
    expect(canWrite(MAYA, s, mayaBoard)).toBe(false);
  });
});

describe('whiteboard ops', () => {
  it('stamps the real author, whatever the client claims', () => {
    const s = sanitizeStroke({ ...stroke('a'), authorId: 'someone-else' }, MAYA, 5);
    expect(s.authorId).toBe(MAYA);
    expect(s.t).toBe(5);
  });

  it('rejects malformed strokes', () => {
    expect(() => sanitizeStroke({ ...stroke('a'), color: 'red' }, MAYA)).toThrow(OpError);
    expect(() => sanitizeStroke({ ...stroke('a'), points: [1, 2, 3] }, MAYA)).toThrow(OpError);
    expect(() => sanitizeStroke({ ...stroke('a'), layer: '../x' }, MAYA)).toThrow(OpError);
    expect(() => sanitizeStroke({ ...stroke('a'), tool: 'flamethrower' }, MAYA)).toThrow(OpError);
    expect(() => sanitizeStroke({ ...stroke('a'), points: [NaN, 1] }, MAYA)).toThrow(OpError);
    expect(() => sanitizeStroke({ ...stroke('a'), tool: 'text', text: '  ' }, MAYA)).toThrow(OpError);
  });

  it('two people drawing at once both keep their work (no overwrite)', () => {
    const doc = emptyDoc();
    applyOp(doc, sanitizeOp({ type: 'add', stroke: stroke('m1') }, MAYA), MAYA, false);
    applyOp(doc, sanitizeOp({ type: 'add', stroke: stroke('j1') }, JAY), JAY, false);
    expect(doc.strokes.map((s) => s.id)).toEqual(['m1', 'j1']);
  });

  it('resending the same stroke after a reconnect is a no-op', () => {
    const doc = emptyDoc();
    const op = sanitizeOp({ type: 'add', stroke: stroke('m1') }, MAYA);
    expect(applyOp(doc, op, MAYA, false).changed).toBe(true);
    expect(applyOp(doc, op, MAYA, false).changed).toBe(false);
    expect(doc.strokes).toHaveLength(1);
  });

  it("a student cannot erase a classmate's work; the tutor can", () => {
    const doc = emptyDoc();
    applyOp(doc, sanitizeOp({ type: 'add', stroke: stroke('m1') }, MAYA), MAYA, false);
    const rm = sanitizeOp({ type: 'remove', ids: ['m1'] }, JAY);
    expect(applyOp(doc, rm, JAY, false).changed).toBe(false);
    expect(doc.strokes).toHaveLength(1);
    expect(applyOp(doc, rm, TUTOR, true).changed).toBe(true);
    expect(doc.strokes).toHaveLength(0);
  });

  it('"clear mine" only clears my strokes on that layer; tutor "clear all" clears the layer', () => {
    const doc = emptyDoc();
    applyOp(doc, sanitizeOp({ type: 'add', stroke: stroke('m1') }, MAYA), MAYA, false);
    applyOp(doc, sanitizeOp({ type: 'add', stroke: stroke('j1') }, JAY), JAY, false);
    applyOp(doc, sanitizeOp({ type: 'add', stroke: stroke('jq', 'q') }, JAY), JAY, false);

    const mine = applyOp(doc, sanitizeOp({ type: 'clear', layer: 'p:page1', scope: 'mine' }, JAY), JAY, false);
    expect(mine.applied).toEqual({ type: 'remove', ids: ['j1'] });
    expect(doc.strokes.map((s) => s.id)).toEqual(['m1', 'jq']);

    // A student asking for "all" only ever clears their own.
    applyOp(doc, sanitizeOp({ type: 'clear', layer: 'p:page1', scope: 'all' }, JAY), JAY, false);
    expect(doc.strokes.map((s) => s.id)).toEqual(['m1', 'jq']);

    applyOp(doc, sanitizeOp({ type: 'clear', layer: 'p:page1', scope: 'all' }, TUTOR), TUTOR, true);
    expect(doc.strokes.map((s) => s.id)).toEqual(['jq']);
  });

  it('strokes must land on a page that exists; pages can be added', () => {
    const doc = emptyDoc();
    const onP2 = sanitizeOp({ type: 'add', stroke: stroke('x', 'p:page2') }, MAYA);
    expect(() => applyOp(doc, onP2, MAYA, false)).toThrow(OpError);
    applyOp(doc, sanitizeOp({ type: 'addPage', page: { id: 'page2' } }, MAYA), MAYA, false);
    expect(applyOp(doc, onP2, MAYA, false).changed).toBe(true);
  });
});

describe('questions', () => {
  it('keeps the text and figure, drops unsafe image links', () => {
    const q = sanitizeQuestion({
      source: 'bank',
      stem: 'Find -3 + 7',
      figure: { type: 'number_line', min: -8, max: 8 },
      imageUrl: 'javascript:alert(1)',
    });
    expect(q?.stem).toBe('Find -3 + 7');
    expect(q?.figure).toEqual({ type: 'number_line', min: -8, max: 8 });
    expect(q?.imageUrl).toBeUndefined();
  });

  it('requires question text', () => {
    expect(() => sanitizeQuestion({ stem: '' })).toThrow(OpError);
    expect(sanitizeQuestion(null)).toBeNull();
  });
});

describe('safety limits', () => {
  it('only allows question pictures hosted on EdKairos', () => {
    expect(isOwnImageHost('https://app.edkairos.com/files/q1.png')).toBe(true);
    expect(isOwnImageHost('https://edkairos.com/a.png')).toBe(true);
    expect(isOwnImageHost('https://evil.example/edkairos.com.png')).toBe(false);
    expect(isOwnImageHost('https://edkairos.com.evil.example/a.png')).toBe(false);
    expect(isOwnImageHost('http://app.edkairos.com/a.png')).toBe(false);
  });

  it('rate limiter allows a burst, then a steady rate', () => {
    const rl = new RateLimiter(10, 5);
    const t = Date.now();
    const burst = Array.from({ length: 8 }, () => rl.take(t)).filter(Boolean).length;
    expect(burst).toBe(5);
    expect(rl.take(t + 100)).toBe(true); // one token back after 100 ms at 10/s
    expect(rl.take(t + 100)).toBe(false);
  });

  it('caps a single stroke', () => {
    const big = { ...stroke('big'), points: new Array(2002).fill(1) };
    expect(() => sanitizeStroke(big, MAYA)).toThrow(OpError);
  });
});

describe('ink colors', () => {
  it('on the group board everyone keeps their own color', () => {
    expect(inkFor('#dc2626', '#1d4ed8', 'GROUP')).toBe('#1d4ed8');
  });
  it('on a private board the palette is allowed', () => {
    expect(inkFor('#DC2626', '#1d4ed8', 'PRIVATE')).toBe('#dc2626');
  });
  it("nobody can pick the tutor's green or an arbitrary color", () => {
    expect(inkFor('#007a00', '#1d4ed8', 'PRIVATE')).toBe('#1d4ed8');
    expect(inkFor('#123456', '#1d4ed8', 'PRIVATE')).toBe('#1d4ed8');
  });
  it('picture questions are built by the server and never accepted from a client', () => {
    expect(uploadQuestion('abc', 800, 600).imageUrl).toBe('asset:abc');
    expect(sanitizeQuestion({ stem: 'x', imageUrl: 'asset:abc' })?.imageUrl).toBeUndefined();
  });
});
