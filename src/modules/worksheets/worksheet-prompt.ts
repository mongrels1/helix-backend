/**
 * Build W: one AI call that drafts the teacher's check screen from an uploaded
 * worksheet (and optionally its key). It is a DRAFT for a person to confirm:
 * nothing it returns reaches a student until the teacher presses Confirm, and
 * it is never used for scoring.
 */

export const WORKSHEET_DRAFT_SYSTEM = `You transcribe a teacher's multiple-choice math worksheet into JSON so the teacher can check it.
Rules:
- Transcribe; do not solve unless told to, and never invent questions or options that are not on the page.
- Every question has exactly four options labelled A, B, C, D. Copy each option's text exactly (numbers, units, signs, fractions as a/b, mixed numbers like 10 1/2).
- "stem" is the question itself, plus only the facts from its problem box that a student needs to answer it (for example the prices or the table values). Keep it short and in plain text.
- Feedback: for each WRONG letter write one short, kind sentence to the student naming the likely mistake, using the problem's own numbers (e.g. "You doubled the $3 fee too. The fee is charged once per order."). Never write feedback for the correct letter. Never state the correct answer or the correct letter in feedback.
- If the teacher's notes say what a wrong letter means, use that meaning.
- Output ONLY JSON, no commentary.`;

export function buildDraftPrompt(args: {
  worksheetText: string;
  keyText?: string;
  typedKey?: string[];
  pageCount: number;
  keyPageCount: number;
}): string {
  const parts: string[] = [];
  parts.push(
    `The first ${args.pageCount} image(s) are the student worksheet` +
      (args.keyPageCount ? `; the last ${args.keyPageCount} image(s) are the teacher's answer key.` : '.'),
  );
  if (args.worksheetText.trim()) {
    parts.push('Text extracted from the worksheet PDF (use it to copy numbers exactly; the images show layout and figures):', '<<<', args.worksheetText.trim().slice(0, 30000), '>>>');
  }
  if (args.keyText?.trim()) {
    parts.push("Text extracted from the teacher's answer key:", '<<<', args.keyText.trim().slice(0, 15000), '>>>');
  }
  if (args.typedKey?.length) {
    parts.push(
      `The teacher typed this answer key, one letter per question in order: ${args.typedKey.join(' ')}.`,
      'Use it as the key exactly. Write feedback for the other three letters of each question.',
    );
  } else {
    parts.push(
      "Read the correct letter for each question from the teacher's key if one is provided. If there is no key, put null for that question's key; do not solve the problem yourself.",
    );
  }
  parts.push(
    'Return JSON shaped exactly like:',
    '{"questions":[{"stem":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"key":"C","feedback":{"A":"...","B":"...","D":"..."}}],"notes":["anything you could not read"]}',
    'Questions in the order they are numbered on the worksheet.',
  );
  return parts.join('\n');
}

export function extractJsonObject<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
