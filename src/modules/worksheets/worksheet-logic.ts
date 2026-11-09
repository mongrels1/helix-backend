/**
 * Build W: the rules for A–D worksheets, kept free of the database and of AI
 * so they can be tested exhaustively. Scoring is a letter-by-letter compare
 * against the teacher-confirmed key: the same answers always get the same
 * score, and nothing here ever guesses.
 */

export const LETTERS = ['A', 'B', 'C', 'D'] as const;
export type Letter = (typeof LETTERS)[number];

export const MAX_QUESTIONS = 60;
export const MAX_PAGES = 12;
export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_PAGE_BYTES = 20 * 1024 * 1024;

/**
 * Where the question sits on the worksheet: a box on one page, as fractions of
 * the page picture (0–1). Students see this crop above the A–D buttons, so the
 * problem's table, graph or diagram is always on the same screen as the choices.
 */
export interface QuestionCrop {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A small table the question needs (e.g. gallons → cost), shown as a real table. */
export interface QuestionTable {
  headers: string[];
  rows: string[][];
}

export interface WorksheetQuestion {
  n: number;
  /** The facts from the problem box the student needs (story, prices), shown above the question. */
  context?: string;
  stem: string;
  table?: QuestionTable;
  options: Record<Letter, string>;
  /** One line per WRONG letter: the mistake that letter usually means. */
  feedback: Partial<Record<Letter, string>>;
  /** Draft only: where a graph or diagram is on the page (the teacher adjusts it; never shown as a page photo). */
  crop?: QuestionCrop;
  /** Saved: the graph/diagram picture, stored high-resolution as WorksheetPage pageNo. */
  figure?: { pageNo: number };
}

export const FIGURE_PAGE_BASE = 1000;
const MAX_COLS = 8;
const MAX_ROWS = 20;

export function normalizeTable(raw: any): QuestionTable | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) return null;
  const cell = (v: unknown) => (typeof v === 'number' ? String(v) : clean(v, 60));
  const headers = (Array.isArray(raw.headers) ? raw.headers : []).slice(0, MAX_COLS).map(cell);
  const rows = (raw.rows as unknown[])
    .filter(Array.isArray)
    .slice(0, MAX_ROWS)
    .map((r: any) => (r as unknown[]).slice(0, MAX_COLS).map(cell))
    .filter((r: string[]) => r.some(Boolean));
  if (!rows.length) return null;
  return { headers, rows };
}

const MIN_CROP = 0.03;

/** A crop clamped inside its page, or null when it is missing or unusable. */
export function normalizeCrop(raw: any): QuestionCrop | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const page = Math.round(num(raw.page));
  let x = num(raw.x), y = num(raw.y), w = num(raw.w), h = num(raw.h);
  if (![page, x, y, w, h].every(Number.isFinite) || page < 1) return null;
  x = Math.min(Math.max(x, 0), 1);
  y = Math.min(Math.max(y, 0), 1);
  w = Math.min(Math.max(w, 0), 1 - x);
  h = Math.min(Math.max(h, 0), 1 - y);
  if (w < MIN_CROP || h < MIN_CROP) return null;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { page, x: r(x), y: r(y), w: r(w), h: r(h) };
}

export function isLetter(x: unknown): x is Letter {
  return typeof x === 'string' && (LETTERS as readonly string[]).includes(x);
}

/** "c d, C-D a" → ['C','D','C','D','A']. Anything that is not A–D is kept as-is so the check can name it. */
export function parseKeyText(text: string): string[] {
  return (text ?? '')
    .toUpperCase()
    .replace(/\b\d+\s*[.):-]?\s*/g, ' ') // "1. C 2) D" numbering
    .split(/[\s,;|/-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const clean = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/**
 * The AI may write options as {"A": ...}, {"a": ...}, ["...", ...], or
 * [{"letter":"A","text":...}], sometimes with the letter repeated ("A) $5").
 * Accept all of them so no printed choice is lost.
 */
function readOptions(raw: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const strip = (v: unknown, L: string) => (typeof v === 'string' ? v.replace(new RegExp(`^\\s*\\(?${L}\\s*[).:]\\s+`, 'i'), '') : typeof v === 'number' ? String(v) : v);
  if (Array.isArray(raw)) {
    raw.slice(0, 4).forEach((o: any, i) => {
      if (o && typeof o === 'object') {
        const L = String(o.letter ?? o.label ?? LETTERS[i]).trim().toUpperCase();
        if ((LETTERS as readonly string[]).includes(L)) out[L] = strip(o.text ?? o.value ?? o.option, L);
      } else out[LETTERS[i]] = strip(o, LETTERS[i]);
    });
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const L = k.trim().replace(/[).:]$/, '').toUpperCase();
      if ((LETTERS as readonly string[]).includes(L)) out[L] = strip(v, L);
    }
  }
  return out;
}

/** Tidy one choice copied from the PDF text layer: stacked fractions, "2 g" → "2g", spacing. */
function tidyPdfChoice(s: string): string {
  return s
    .replace(/(\d)\s{2,}(\d) (\d)(?=\s{2,}|\s*$)/g, '$1 $2/$3') // 10   1 2  → 10 1/2
    .replace(/(^|\s)(\d) (\d)(?=\s{2,}|\s*$)/g, '$1$2/$3') //   1 2   x → 1/2 x
    .replace(/\s+/g, ' ')
    .replace(/(\d) ([a-z])(?![a-z])/g, '$1$2') // 2 g → 2g
    .trim();
}

/**
 * When the AI leaves a question's A–D choices blank but the PDF has a text
 * layer, copy the four choices from the text right after that question's
 * number and stem. Only fills when all four letters are found, in order.
 * Returns the question numbers that were filled (the teacher still checks).
 */
export function fillOptionsFromPdfText(questions: WorksheetQuestion[], pdfText: string | undefined): number[] {
  const filled: number[] = [];
  const text = (pdfText ?? '').replace(/\r?\n/g, '   ').replace(/ /g, ' ');
  if (!text.trim()) return filled;
  const words = (s: string) => s.toLowerCase().replace(/^\s*\(?\d{1,2}\s*[.):]\s*/, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const END = /(?=\s{2,}\d{1,2}\s{2,}\S|\s{2,}(?:[A-Z][a-z]+\s{2,})?(?:[A-Z]\s{1,3}){2,}[A-Z]|\s{2,}Adapted\b|\s{2,}[A-Z][a-z]+(?: [a-z]+){0,3}:|\s*$)/.source;
  const CHOICES = new RegExp(`^\\s{2,}A\\s{2,}(.+?)\\s{2,}B\\s{2,}(.+?)\\s{2,}C\\s{2,}(.+?)\\s{2,}D\\s{2,}(.+?)${END}`);
  /** The four choices printed after position `at`, or null. */
  const parseAt = (at: number): { choices: string[]; end: number } | null => {
    const seg = text.slice(at, at + 900);
    const a = seg.search(/\s{2,}A\s{2,}/);
    if (a < 0 || a > 400) return null;
    const m = seg.slice(a).match(CHOICES);
    if (!m) return null;
    const choices = m.slice(1, 5).map(tidyPdfChoice);
    if (choices.some((c) => !c || c.length > 300)) return null;
    return { choices, end: at + a + m[0].length };
  };
  // Walk the questions in order. For each number, prefer the spot whose words
  // match the AI's question text; otherwise the first spot after the previous
  // question that has four lettered choices.
  let cursor = 0;
  questions.forEach((q, i) => {
    const n = i + 1;
    const want = words(q.stem).slice(0, 2).join(' ');
    const re = new RegExp(`(?:^|\\s{2,})${n}\\s{2,}(?=\\S)`, 'g');
    re.lastIndex = cursor;
    let best: { choices: string[]; end: number } | null = null;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const at = m.index + m[0].length;
      const found = parseAt(at);
      if (!found) continue;
      const matches = !!want && words(text.slice(at, at + 120)).join(' ').startsWith(want);
      if (matches) { best = found; break; }
      if (!best) best = found;
    }
    if (!best) return;
    cursor = best.end;
    if (LETTERS.every((L) => q.options[L]?.trim())) return;
    LETTERS.forEach((L, k) => { q.options[L] = best!.choices[k]; });
    filled.push(n);
  });
  return filled;
}

/** Coerce untrusted input (AI draft or a teacher's edited copy) into the stored shape. */
export function normalizeQuestions(raw: unknown): WorksheetQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_QUESTIONS).map((q: any, i: number) => {
    const options = {} as Record<Letter, string>;
    const feedback: Partial<Record<Letter, string>> = {};
    const opts = readOptions(q?.options);
    for (const L of LETTERS) {
      options[L] = clean(opts[L], 300);
      const f = clean(q?.feedback?.[L], 300);
      if (f) feedback[L] = f;
    }
    const crop = normalizeCrop(q?.crop);
    const table = normalizeTable(q?.table);
    const context = clean(q?.context, 800);
    const figPage = Math.round(Number(q?.figure?.pageNo));
    return {
      n: i + 1,
      ...(context ? { context } : {}),
      stem: clean(q?.stem, 600),
      ...(table ? { table } : {}),
      options,
      feedback,
      ...(crop ? { crop } : {}),
      ...(Number.isFinite(figPage) && figPage > FIGURE_PAGE_BASE ? { figure: { pageNo: figPage } } : {}),
    };
  });
}

/**
 * Everything that must be true before a worksheet can reach students.
 * Returns plain-language problems for the teacher; empty = ready.
 */
export function validateWorksheet(questions: WorksheetQuestion[], key: string[], pageCount?: number): string[] {
  const problems: string[] = [];
  if (questions.length === 0) problems.push('No questions were found. Add them before assigning.');
  if (questions.length > MAX_QUESTIONS) problems.push(`A worksheet can have at most ${MAX_QUESTIONS} questions.`);
  if (key.length !== questions.length) {
    problems.push(`The key has ${key.length} letter${key.length === 1 ? '' : 's'} but the worksheet has ${questions.length} question${questions.length === 1 ? '' : 's'}.`);
  }
  key.forEach((k, i) => {
    if (!isLetter(k)) problems.push(`Question ${i + 1}: the key must be A, B, C or D (it is "${k}").`);
  });
  questions.forEach((q, i) => {
    if (!q.stem) problems.push(`Question ${i + 1}: the question text is empty.`);
    const missing = LETTERS.filter((L) => !q.options[L]);
    if (missing.length) problems.push(`Question ${i + 1}: option ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} empty.`);
    const texts = LETTERS.map((L) => q.options[L].toLowerCase()).filter(Boolean);
    if (new Set(texts).size !== texts.length) problems.push(`Question ${i + 1}: two options have the same text.`);
    if (pageCount !== undefined && q.crop && q.crop.page > pageCount) problems.push(`Question ${i + 1}: its graph is on a page that does not exist.`);
    if (q.table) {
      const width = Math.max(q.table.headers.length, ...q.table.rows.map((r) => r.length));
      if (q.table.rows.some((r) => r.length !== width) || (q.table.headers.length && q.table.headers.length !== width)) {
        problems.push(`Question ${i + 1}: every table row needs the same number of cells.`);
      }
    }
  });
  return problems;
}

/** A student's answers as exactly `n` slots; anything that is not A–D is blank. */
export function normalizeAnswers(raw: unknown, n: number): (Letter | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => {
    const v = typeof arr[i] === 'string' ? arr[i].trim().toUpperCase() : null;
    return isLetter(v) ? v : null;
  });
}

export function scoreAnswers(answers: (Letter | null)[], key: string[]): { score: number; correct: boolean[] } {
  const correct = key.map((k, i) => answers[i] !== null && answers[i] === k);
  return { score: correct.filter(Boolean).length, correct };
}

/** Correct answers are shown only once the due date has passed. No due date = never automatically. */
export function answersRevealed(dueAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!dueAt && now.getTime() >= dueAt.getTime();
}

/** Submissions close at the due date (the answers become visible then). */
export function isClosed(dueAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !!dueAt && now.getTime() > dueAt.getTime();
}

export interface StudentQuestionResult {
  n: number;
  yourAnswer: Letter | null;
  correct: boolean;
  /** The note for the letter they picked, when it was wrong. */
  feedback: string | null;
  /** Only after the due date. */
  correctAnswer?: Letter;
}

export interface StudentResult {
  score: number;
  maxScore: number;
  submittedAt: string | null;
  answersRevealed: boolean;
  revealAt: string | null;
  questions: StudentQuestionResult[];
}

/** What a student is allowed to see about their own scored attempt. */
export function studentResult(args: {
  answers: (Letter | null)[];
  key: string[];
  questions: WorksheetQuestion[];
  dueAt: Date | null;
  submittedAt: Date | null;
  now?: Date;
}): StudentResult {
  const { score, correct } = scoreAnswers(args.answers, args.key);
  const revealed = answersRevealed(args.dueAt, args.now);
  return {
    score,
    maxScore: args.key.length,
    submittedAt: args.submittedAt ? args.submittedAt.toISOString() : null,
    answersRevealed: revealed,
    revealAt: args.dueAt ? args.dueAt.toISOString() : null,
    questions: args.key.map((k, i) => {
      const yours = args.answers[i] ?? null;
      const out: StudentQuestionResult = {
        n: i + 1,
        yourAnswer: yours,
        correct: correct[i],
        feedback: !correct[i] && yours ? args.questions[i]?.feedback?.[yours] ?? null : null,
      };
      if (revealed) out.correctAnswer = k as Letter;
      return out;
    }),
  };
}

/** Per-question class summary for the teacher. */
export function itemAnalysis(key: string[], attempts: (Letter | null)[][]) {
  return key.map((k, i) => {
    const counts: Record<Letter | 'blank', number> = { A: 0, B: 0, C: 0, D: 0, blank: 0 };
    for (const a of attempts) counts[a[i] ?? 'blank'] += 1;
    const n = attempts.length;
    return { n: i + 1, key: k, counts, percentCorrect: n ? Math.round((counts[k as Letter] / n) * 100) : null };
  });
}

/** Decode a `data:image/...;base64,` URL and confirm the bytes really are JPEG/PNG/WebP. */
export function decodePageImage(dataUrl: unknown): { mime: string; bytes: Buffer } | null {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) return null;
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length < 12 || bytes.length > MAX_PAGE_BYTES) return null;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null;
  return mime ? { mime, bytes } : null;
}

/**
 * True when the upload does not look like an A–D worksheet: at least half the
 * questions are missing options or repeat the same option text (what happens
 * when a "circle Proportional / Not proportional" sheet is forced into A–D).
 */
export function looksNotAD(questions: WorksheetQuestion[]): { notAD: boolean; bad: number } {
  const bad = questions.filter((q) => {
    const texts = LETTERS.map((L) => q.options[L].trim().toLowerCase());
    return texts.some((t) => !t) || new Set(texts).size < 4;
  }).length;
  return { notAD: questions.length > 0 && bad * 2 >= questions.length, bad };
}
