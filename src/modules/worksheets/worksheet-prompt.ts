/**
 * Build W: one AI call that drafts the teacher's check screen from an uploaded
 * worksheet (and optionally its key). It is a DRAFT for a person to confirm:
 * nothing it returns reaches a student until the teacher presses Confirm, and
 * it is never used for scoring.
 */

export const WORKSHEET_DRAFT_SYSTEM = `You transcribe a teacher's multiple-choice math worksheet into JSON so the teacher can check it.
Rules:
- Transcribe; do not solve unless told to, and never invent questions or options that are not on the page.
- Copy each printed A, B, C, D option's text exactly (numbers, units, signs, fractions as a/b, mixed numbers like 10 1/2).
- Most worksheets print four lettered choices under EVERY question, often as equations or in a 2-by-2 grid, and also under questions that have a table or graph. Copy all four for every question; check the extracted text below, where each question's choices follow it as "A ... B ... C ... D ...".
- NEVER invent options. If a question does not have four choices printed with the letters A, B, C, D (for example "Circle: Proportional / Not proportional", a blank to fill in, or a table to complete), still list it, but leave every option as "" and add a note naming the question. Do not repeat one choice to fill four slots.
- The student will see each question on its own phone screen as clean text, NOT as a picture of the page. So for each question give:
  - "context": the facts from its problem box the student needs, in one or two short plain sentences (e.g. "The taxi charges $4 plus $1.50 per mile. Cherie rides 7 miles."). Leave out worksheet directions, the printed answer bubbles and anything another question asks. "" if none.
  - "stem": the question itself, exactly as printed, without its number.
  - "table": if the problem box has a table the student needs, {"headers":[...],"rows":[[...],...]} with every cell copied exactly (fractions as a/b, mixed numbers like 17 1/2, blank cells as ""); otherwise null. Do not put table values into the context.
- Feedback: for each WRONG letter write one short, kind sentence to the student naming the likely mistake, using the problem's own numbers (e.g. "You doubled the $3 fee too. The fee is charged once per order."). Never write feedback for the correct letter. Never state the correct answer or the correct letter in feedback.
- If the teacher's notes say what a wrong letter means, use that meaning.
- "crop": ONLY when the student needs a graph, diagram, picture or number line that cannot be written as text or a table; otherwise null. Then give the box around that drawing alone (with its labels such as "Graph 1"), NOT around text, tables, the question or the answer bubbles. Each worksheet image has a red grid: lines every 0.1 of the page width and height, labelled 0.1 to 0.9 along the top and left edges. Give {"page": the worksheet page number (1 = first image), "x", "y" = top-left corner, "w", "h"}, all as fractions of the page (0 to 1). Questions that share one set of graphs each get that same box.
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
    '{"questions":[{"context":"...","stem":"...","table":null,"options":{"A":"...","B":"...","C":"...","D":"..."},"key":"C","feedback":{"A":"...","B":"...","D":"..."},"crop":null}],"notes":["anything you could not read"]}',
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

/**
 * When the reply is cut off or has extra text, keep every COMPLETE question
 * object inside "questions": [ … ] (string-aware brace matching).
 */
export function salvageQuestions(text: string): any[] {
  const out: any[] = [];
  if (!text) return out;
  const k = text.indexOf('"questions"');
  if (k < 0) return out;
  let i = text.indexOf('[', k);
  if (i < 0) return out;
  i++;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text[i] !== '{') break;
    let depth = 0;
    let inStr = false;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    if (j >= text.length) break; // cut off mid-question
    try { out.push(JSON.parse(text.slice(i, j + 1))); } catch { break; }
    i = j + 1;
  }
  return out;
}

