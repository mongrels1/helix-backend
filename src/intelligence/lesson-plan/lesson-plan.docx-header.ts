// jszip publishes `export = JSZip`; this repo's tsconfig has esModuleInterop off,
// so the require-style import is what resolves correctly at runtime.
import JSZip = require('jszip');

export interface HeaderFields {
  school?: string;
  teacher?: string;
  grade?: string;
  unit?: string;
  dates?: string;
}

const LABELS: { re: RegExp; key: keyof HeaderFields }[] = [
  { re: /school\s*:/i, key: 'school' },
  { re: /teacher(s)?\s*:/i, key: 'teacher' },
  { re: /grade\s*:/i, key: 'grade' },
  { re: /unit\s*:/i, key: 'unit' },
  { re: /(dates?|week\s*of)\s*:/i, key: 'dates' },
];

const decode = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const encode = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Label-anchored replacement inside a single header XML part.
 * Each label run ("School:", "| Teachers:", "| Grade:", "| Unit:", "| Dates:")
 * is followed by its value run(s); we replace the value, not the label, so it
 * works regardless of the template's placeholder text. No-ops when a label or
 * value can't be found.
 */
function patchHeaderXml(xml: string, fields: HeaderFields): string {
  const runRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  const runs: { open: string; text: string; close: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(xml)) !== null) {
    runs.push({ open: m[1], text: m[2], close: m[3], start: m.index, end: m.index + m[0].length });
  }

  const repl = new Map<number, string>();
  for (let i = 0; i < runs.length; i++) {
    const label = LABELS.find((l) => l.re.test(decode(runs[i].text)));
    if (!label) continue;
    const val = fields[label.key];
    if (val == null || String(val).trim() === '') continue;

    // value region = runs after the label until one that starts a new field
    // (contains "|") or is itself a label; for most fields this is one run,
    // for split placeholders (e.g. dates "MMDDYY"-"MMDDYY") it's several.
    let j = i + 1;
    const region: number[] = [];
    while (j < runs.length) {
      const tj = decode(runs[j].text);
      if (tj.includes('|') || LABELS.some((l) => l.re.test(tj))) break;
      region.push(j);
      j++;
    }
    if (region.length === 0) continue;
    repl.set(region[0], encode(String(val).trim()));
    for (let k = 1; k < region.length; k++) repl.set(region[k], '');
    i = j - 1;
  }

  if (repl.size === 0) return xml;
  let out = xml;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (!repl.has(i)) continue;
    const r = runs[i];
    out = out.slice(0, r.start) + r.open + repl.get(i)! + r.close + out.slice(r.end);
  }
  return out;
}

/**
 * Writes the Step-3 header fields (School / Teachers / Grade / Unit / Dates) into
 * a filled lesson-plan .docx. The deterministic sidecar fills the body grid but
 * not the header; this closes that gap in-process. Wrapped so a header-patch
 * problem can never break generation — on any error the original file is returned.
 */
export async function patchDocxHeader(docx: Buffer, fields: HeaderFields): Promise<Buffer> {
  const hasAny = fields && Object.values(fields).some((v) => v != null && String(v).trim() !== '');
  if (!hasAny) return docx;
  try {
    const zip = await JSZip.loadAsync(docx);
    const headerNames = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/i.test(n));
    if (headerNames.length === 0) return docx;
    for (const name of headerNames) {
      const file = zip.file(name);
      if (!file) continue;
      const xml = await file.async('string');
      zip.file(name, patchHeaderXml(xml, fields));
    }
    return zip.generateAsync({ type: 'nodebuffer' });
  } catch {
    return docx;
  }
}
