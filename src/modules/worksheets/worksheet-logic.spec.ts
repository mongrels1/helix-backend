import {
  LETTERS,
  looksNotAD,
  normalizeCrop,
  normalizeTable,
  answersRevealed,
  decodePageImage,
  isClosed,
  itemAnalysis,
  normalizeAnswers,
  normalizeQuestions,
  parseKeyText,
  scoreAnswers,
  studentResult,
  validateWorksheet,
} from './worksheet-logic';

// The real test case: Proportional or Not? Homework (A–D), 15 questions.
const KEY = 'C D C D A D B C A B C A B B D'.split(' ');
const q = (i: number) => ({
  stem: `Question ${i + 1}`,
  options: { A: `a${i}`, B: `b${i}`, C: `c${i}`, D: `d${i}` },
  feedback: { A: `fa${i}`, B: `fb${i}`, C: `fc${i}`, D: `fd${i}` },
});
const QUESTIONS = normalizeQuestions(Array.from({ length: 15 }, (_, i) => q(i)));

describe('parseKeyText', () => {
  it('reads spaced, comma, numbered and lower-case keys', () => {
    expect(parseKeyText('C D C D A D B C A B C A B B D')).toEqual(KEY);
    expect(parseKeyText('c,d,c,d')).toEqual(['C', 'D', 'C', 'D']);
    expect(parseKeyText('1. C 2. D 3) C 4-D')).toEqual(['C', 'D', 'C', 'D']);
    expect(parseKeyText('1C 2D')).toEqual(['C', 'D']);
  });
  it('keeps non-letters so the check can name them', () => {
    expect(parseKeyText('C E D')).toEqual(['C', 'E', 'D']);
  });
});

describe('validateWorksheet (fail-closed)', () => {
  it('accepts the real homework', () => {
    expect(validateWorksheet(QUESTIONS, KEY)).toEqual([]);
  });
  it('blocks a short or long key', () => {
    expect(validateWorksheet(QUESTIONS, KEY.slice(0, 14))[0]).toMatch(/14 letters but the worksheet has 15/);
    expect(validateWorksheet(QUESTIONS, [...KEY, 'A'])[0]).toMatch(/16 letters/);
  });
  it('blocks a key letter that is not A–D', () => {
    const k = [...KEY];
    k[3] = 'E';
    expect(validateWorksheet(QUESTIONS, k)).toEqual(['Question 4: the key must be A, B, C or D (it is "E").']);
  });
  it('blocks a missing option, an empty stem, duplicate options and no questions', () => {
    const qs = normalizeQuestions(Array.from({ length: 15 }, (_, i) => q(i)));
    qs[0].options.C = '';
    qs[1].stem = '';
    qs[2].options.B = qs[2].options.A;
    const p = validateWorksheet(qs, KEY);
    expect(p).toContain('Question 1: option C is empty.');
    expect(p).toContain('Question 2: the question text is empty.');
    expect(p).toContain('Question 3: two options have the same text.');
    expect(validateWorksheet([], [])[0]).toMatch(/No questions/);
  });
});

describe('normalizeAnswers', () => {
  it('always returns exactly n slots; non A–D is blank', () => {
    expect(normalizeAnswers(['a', 'B', 'E', 7, null, ' c '], 7)).toEqual(['A', 'B', null, null, null, 'C', null]);
    expect(normalizeAnswers('CDCD', 3)).toEqual([null, null, null]);
    expect(normalizeAnswers(['A', 'B', 'C'], 2)).toEqual(['A', 'B']);
  });
});

describe('scoreAnswers', () => {
  it('perfect key scores 15/15', () => {
    expect(scoreAnswers(KEY as any, KEY).score).toBe(15);
  });
  it('all A scores the hand count (Q5, Q9, Q12 = 3)', () => {
    const allA = normalizeAnswers(Array(15).fill('A'), 15);
    expect(scoreAnswers(allA, KEY).score).toBe(KEY.filter((k) => k === 'A').length);
    expect(scoreAnswers(allA, KEY).score).toBe(3);
  });
  it('blank never matches', () => {
    expect(scoreAnswers(normalizeAnswers([], 15), KEY).score).toBe(0);
  });
  it('every single-letter sheet sums to 15 across A–D (no letter double-counted)', () => {
    const total = LETTERS.map((L) => scoreAnswers(normalizeAnswers(Array(15).fill(L), 15), KEY).score).reduce((a, b) => a + b, 0);
    expect(total).toBe(15);
  });
  it('is deterministic over many random sheets and matches an independent count', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 2000; t++) {
      const sheet = Array.from({ length: 15 }, () => (rnd() < 0.1 ? null : LETTERS[Math.floor(rnd() * 4)]));
      let hand = 0;
      for (let i = 0; i < 15; i++) if (sheet[i] === KEY[i]) hand++;
      expect(scoreAnswers(sheet, KEY).score).toBe(hand);
      expect(scoreAnswers(sheet, KEY).score).toBe(scoreAnswers([...sheet], KEY).score);
    }
  });
});

describe('due date rules', () => {
  const due = new Date('2026-11-12T23:59:00Z');
  it('answers are hidden before the due date and shown at/after it', () => {
    expect(answersRevealed(due, new Date('2026-11-12T23:58:59Z'))).toBe(false);
    expect(answersRevealed(due, due)).toBe(true);
    expect(answersRevealed(null)).toBe(false);
  });
  it('submissions close after the due date', () => {
    expect(isClosed(due, due)).toBe(false);
    expect(isClosed(due, new Date(due.getTime() + 1))).toBe(true);
    expect(isClosed(null)).toBe(false);
  });
});

describe('studentResult', () => {
  const due = new Date('2026-11-12T23:59:00Z');
  const answers = normalizeAnswers([...KEY.slice(0, 14), 'A'], 15); // Q15 wrong with A
  it('before the due date: score + feedback for wrong answers, NO correct letters anywhere', () => {
    const r = studentResult({ answers, key: KEY, questions: QUESTIONS, dueAt: due, submittedAt: new Date(), now: new Date('2026-11-10T12:00:00Z') });
    expect(r.score).toBe(14);
    expect(r.maxScore).toBe(15);
    expect(r.answersRevealed).toBe(false);
    expect(r.questions[14]).toEqual({ n: 15, yourAnswer: 'A', correct: false, feedback: 'fa14' });
    expect(r.questions[0]).toEqual({ n: 1, yourAnswer: 'C', correct: true, feedback: null });
    expect(JSON.stringify(r)).not.toContain('correctAnswer');
  });
  it('after the due date: correct letters are included', () => {
    const r = studentResult({ answers, key: KEY, questions: QUESTIONS, dueAt: due, submittedAt: new Date(), now: new Date('2026-11-13T00:00:00Z') });
    expect(r.answersRevealed).toBe(true);
    expect(r.questions.map((x) => x.correctAnswer)).toEqual(KEY);
  });
  it('a blank answer is wrong with no feedback', () => {
    const r = studentResult({ answers: normalizeAnswers([], 15), key: KEY, questions: QUESTIONS, dueAt: due, submittedAt: null, now: new Date(0) });
    expect(r.questions[0]).toEqual({ n: 1, yourAnswer: null, correct: false, feedback: null });
  });
});

describe('itemAnalysis', () => {
  it('counts each letter and percent correct per question', () => {
    const a = normalizeAnswers(KEY, 15);
    const b = normalizeAnswers(Array(15).fill('A'), 15);
    const c = normalizeAnswers([], 15);
    const items = itemAnalysis(KEY, [a, b, c]);
    expect(items[0]).toEqual({ n: 1, key: 'C', counts: { A: 1, B: 0, C: 1, D: 0, blank: 1 }, percentCorrect: 33 });
    expect(items[4]).toEqual({ n: 5, key: 'A', counts: { A: 2, B: 0, C: 0, D: 0, blank: 1 }, percentCorrect: 67 });
    expect(itemAnalysis(KEY, [])[0].percentCorrect).toBeNull();
  });
});

describe('decodePageImage', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  it('accepts real JPEG bytes', () => {
    expect(decodePageImage(`data:image/jpeg;base64,${jpeg.toString('base64')}`)?.mime).toBe('image/jpeg');
  });
  it('rejects SVG, wrong bytes behind an image label, and non-strings', () => {
    expect(decodePageImage(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)).toBeNull();
    expect(decodePageImage(`data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`)).toBeNull();
    expect(decodePageImage(42)).toBeNull();
  });
});

describe('crops (each question shows its own picture)', () => {
  it('clamps a crop inside its page and rounds it', () => {
    expect(normalizeCrop({ page: 1, x: -0.1, y: 0.2, w: 0.5, h: 2 })).toEqual({ page: 1, x: 0, y: 0.2, w: 0.5, h: 0.8 });
    expect(normalizeCrop({ page: 2.4, x: 0.123456, y: 0.1, w: 0.3, h: 0.3 })).toEqual({ page: 2, x: 0.1235, y: 0.1, w: 0.3, h: 0.3 });
  });
  it('rejects missing, tiny or nonsense crops', () => {
    expect(normalizeCrop(undefined)).toBeNull();
    expect(normalizeCrop({ page: 0, x: 0, y: 0, w: 0.5, h: 0.5 })).toBeNull();
    expect(normalizeCrop({ page: 1, x: 0, y: 0, w: 0.01, h: 0.5 })).toBeNull();
    expect(normalizeCrop({ page: 1, x: 'a', y: 0, w: 0.5, h: 0.5 })).toBeNull();
  });
  it('a graph box is optional, but one on a missing page is flagged', () => {
    const withCrops = normalizeQuestions(Array.from({ length: 15 }, (_, i) => ({ ...q(i), crop: { page: 1 + (i % 2), x: 0.05, y: 0.1, w: 0.4, h: 0.2 } })));
    expect(validateWorksheet(withCrops, KEY, 2)).toEqual([]);
    expect(validateWorksheet(withCrops, KEY, 1).filter((p) => p.includes('page that does not exist'))).toHaveLength(7);
    expect(validateWorksheet(QUESTIONS, KEY, 2)).toEqual([]); // no graph needed
  });
});

describe('question parts: context, table, figure', () => {
  it('keeps context and a clean table; drops empty rows and caps size', () => {
    const [x] = normalizeQuestions([{ ...q(0), context: '  Gas.  Let g = gallons. ', table: { headers: ['Gallons (g)', 'Cost (c)'], rows: [[2, '$7'], ['4', '$14'], ['', ''], ['6', '$21']] } }]);
    expect(x.context).toBe('Gas. Let g = gallons.');
    expect(x.table).toEqual({ headers: ['Gallons (g)', 'Cost (c)'], rows: [['2', '$7'], ['4', '$14'], ['6', '$21']] });
    expect(normalizeTable({ rows: [] })).toBeNull();
    expect(normalizeTable(null)).toBeNull();
  });
  it('flags a ragged table', () => {
    const qs = normalizeQuestions([{ ...q(0), table: { headers: ['a', 'b'], rows: [['1', '2'], ['3']] } }]);
    expect(validateWorksheet(qs, ['C'])).toContain('Question 1: every table row needs the same number of cells.');
  });
  it('a stored figure keeps its picture number; anything else is ignored', () => {
    expect(normalizeQuestions([{ ...q(0), figure: { pageNo: 1005 } }])[0].figure).toEqual({ pageNo: 1005 });
    expect(normalizeQuestions([{ ...q(0), figure: { pageNo: 2 } }])[0].figure).toBeUndefined();
  });
});

describe('looksNotAD', () => {
  it('flags a circle-the-answer sheet forced into A–D', () => {
    const forced = normalizeQuestions(Array.from({ length: 10 }, () => ({ stem: 'Is it proportional?', options: { A: 'Proportional', B: 'Not proportional', C: 'Proportional', D: 'Not proportional' } })));
    expect(looksNotAD(forced)).toEqual({ notAD: true, bad: 10 });
    const blank = normalizeQuestions(Array.from({ length: 4 }, () => ({ stem: 'Fill in', options: {} })));
    expect(looksNotAD(blank).notAD).toBe(true);
  });
  it('does not flag a real A–D worksheet', () => {
    expect(looksNotAD(QUESTIONS)).toEqual({ notAD: false, bad: 0 });
  });
});
