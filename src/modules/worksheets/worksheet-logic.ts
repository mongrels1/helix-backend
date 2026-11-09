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

export interface WorksheetQuestion {
  n: number;
  stem: string;
  options: Record<Letter, string>;
  /** One line per WRONG letter: the mistake that letter usually means. */
  feedback: Partial<Record<Letter, string>>;
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

/** Coerce untrusted input (AI draft or a teacher's edited copy) into the stored shape. */
export function normalizeQuestions(raw: unknown): WorksheetQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_QUESTIONS).map((q: any, i: number) => {
    const options = {} as Record<Letter, string>;
    const feedback: Partial<Record<Letter, string>> = {};
    for (const L of LETTERS) {
      options[L] = clean(q?.options?.[L], 300);
      const f = clean(q?.feedback?.[L], 300);
      if (f) feedback[L] = f;
    }
    return { n: i + 1, stem: clean(q?.stem, 600), options, feedback };
  });
}

/**
 * Everything that must be true before a worksheet can reach students.
 * Returns plain-language problems for the teacher; empty = ready.
 */
export function validateWorksheet(questions: WorksheetQuestion[], key: string[]): string[] {
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
