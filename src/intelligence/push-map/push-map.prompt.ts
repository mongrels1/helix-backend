/**
 * Reading a standardized score report into the extraction contract.
 *
 * The only place in the Push Map pipeline where a model is involved, and it is
 * given exactly one job: transcribe what is printed. It does not interpret, does
 * not decide tracks, and does not write prose — all of that is deterministic in
 * `push-map.tracks.ts`. Anything it returns is shown to a human for confirmation
 * before a single word reaches a parent.
 */

export const SCORE_EXTRACTION_SYSTEM = `You transcribe standardized test score reports into JSON.

You are a transcriber, not an analyst. Copy what is printed. Do not interpret, do not infer, do not compute.

ABSOLUTE RULES
- If a value is not printed on the page, return null. NEVER estimate, average, or infer a number.
- Every number you return must appear verbatim in the text you were given.
- List each field you could not find in "unreadable".
- Return ONLY the JSON object. No preamble, no markdown fences, no commentary.

WHAT TO LOOK FOR
- vendor: which instrument produced this report.
- assessmentName: the report's own name for this administration, e.g. "i-Ready Inform 1", "MAP Growth Winter".
- takenOn: the date the STUDENT SAT the test (often labelled "administered", "taken", or shown beside the score) in YYYY-MM-DD. This is NOT the date the report was printed. If both appear, take the earlier and the one attached to the score.
- studentGrade: the grade the student is enrolled in, as an integer (K = 0).
- overall: the overall/composite mathematics score, its placement label if printed ("Early 4", "Level 2"), and the standard error if printed (often "+/- 8" or "SEM").
- percentile: the national/norm percentile, if printed. NOT the scale score.
- domains: every reported domain/strand/instructional area, with its own score and label. Copy the vendor's exact wording for the name.
- growthTargets: any printed growth targets. i-Ready prints "Typical Growth" and "Stretch Growth"; MAP prints a projected RIT.

SHAPE
{
  "vendor": "IREADY" | "MAP_GROWTH" | "STAR" | "GA_MILESTONES" | "UNKNOWN",
  "assessmentName": string | null,
  "takenOn": "YYYY-MM-DD" | null,
  "studentGrade": number | null,
  "overall": { "score": number | null, "label": string | null, "standardError": number | null },
  "percentile": number | null,
  "domains": [ { "name": string, "score": number | null, "label": string | null } ],
  "growthTargets": { "typical": number | null, "stretch": number | null },
  "unreadable": string[]
}`;

export function buildExtractionPrompt(reportText: string, note?: string): string {
  const trimmed = reportText.length > 60_000 ? `${reportText.slice(0, 60_000)}\n[truncated]` : reportText;
  return [
    'Transcribe this score report into the JSON shape you were given.',
    note?.trim() ? `\nContext the family added (do NOT let this change any number you read):\n${note.trim()}` : '',
    '\n--- REPORT TEXT ---\n',
    trimmed,
    '\n--- END ---\n',
    'Return only the JSON object.',
  ].join('');
}

/**
 * The same job, given page images instead of text.
 *
 * Most score reports have no text layer — schools hand out printed-then-scanned
 * PDFs — so this is the common path, not the fallback. The extra instruction
 * about tables earns its place: every vendor lays the domain scores out as a
 * grid, and a model reading a grid is at its most likely to slide a number one
 * row off and attach it to the wrong domain. That error is invisible
 * downstream — a plausible score against the wrong strand sends a child to the
 * wrong work — so it is called out here and caught on the confirm screen.
 */
export function buildVisionExtractionPrompt(note?: string): string {
  return [
    'These images are the pages of one standardized test score report.',
    ' Transcribe it into the JSON shape you were given.',
    '\n\nRead tables row by row. Each domain score must come from the same row as its',
    ' domain name — if you cannot tell which row a number belongs to, return null for',
    ' that domain and add it to "unreadable". Do not read a number off a chart axis or',
    ' a bar height; only take numbers that are printed as text.',
    note?.trim()
      ? `\n\nContext the family added (do NOT let this change any number you read):\n${note.trim()}`
      : '',
    '\n\nReturn only the JSON object.',
  ].join('');
}

/**
 * Pull the first JSON object out of a reply.
 *
 * Same defensive shape as the lesson-plan extractor: models wrap JSON in fences
 * or prose often enough that failing on it is a self-inflicted outage.
 */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
