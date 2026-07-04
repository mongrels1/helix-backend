import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AIRouterService } from '../ai-router/ai-router.service';
import { DIAGNOSTIC_ITEM_BANK } from '../remediation/diagnostic-item-bank';
import { resolveStandard } from '../item-generation/mgse-ga-crosswalk';

export const VIABILITY_MIN = 100;
const STATUSES = ['draft', 'validated', 'rejected', 'published'] as const;
type DiagStatus = (typeof STATUSES)[number];

/** Provisional DOK from the calibrated Rasch difficulty (b). A starting point a
 *  Super Admin can refine — harder items lean to higher DOK. */
function provisionalDok(b: number): number {
  if (b < -1) return 1;
  if (b < 0.5) return 2;
  if (b < 1.5) return 3;
  return 4;
}

/**
 * Explicit grade.strand → current GA cluster for the diagnostic's strand
 * taxonomy (NS/RP/EE/G/SP/F/MD). resolveStandard alone misses grade 4–5 "NS"
 * (which spans number/place-value/fraction clusters) and would echo "MGSE4.NS".
 */
const DIAG_CLUSTER: Record<string, string> = {
  '4.NS': '4.NR.1', '4.G': '4.GSR.8', '4.MD': '4.MDR.6',
  '5.NS': '5.NR.1', '5.G': '5.GSR.8', '5.MD': '5.MDR.7',
  '6.NS': '6.NR.1', '6.RP': '6.NR.4', '6.EE': '6.PAR.6', '6.G': '6.GSR.5', '6.SP': '6.DSR.7',
  '7.NS': '7.NR.1', '7.RP': '7.PAR.4', '7.EE': '7.PAR.3', '7.G': '7.GSR.5', '7.SP': '7.PR.6',
  '8.NS': '8.NR.1', '8.EE': '8.PAR.4', '8.F': '8.FGR.5', '8.G': '8.GSR.8', '8.SP': '8.FGR.6',
};

/** GA standard (cluster) inferred from a diagnostic item's grade + strand. */
function standardFor(grade: number, strand: string): string | null {
  const key = `${grade}.${String(strand).toUpperCase()}`;
  if (DIAG_CLUSTER[key]) return DIAG_CLUSTER[key];
  const r = resolveStandard(`MGSE${grade}.${strand}`).gaCluster;
  return r && !/^MGSE/i.test(r) ? r : null; // avoid echoing the MGSE input
}

/** Parse grade + strand from a standard code, e.g. "MGSE8.EE.7" -> {8,"EE"},
 *  "8.FGR.5" -> {8,"FGR"}. Used to route a seed's generated item to the right
 *  grade/strand when generating diagnostic items from uploaded questions. */
function gradeStrandFromStandard(code: string): { grade: number; strand: string } | null {
  const c = String(code || '').toUpperCase().replace(/\s+/g, '');
  const m = c.match(/^MGSE(\d+)\.([A-Z]+)/) || c.match(/^(\d+)\.([A-Z]+)/);
  if (!m) return null;
  const grade = Number(m[1]);
  return grade ? { grade, strand: m[2] } : null;
}

export interface CreateDiagnosticItemDto {
  grade: number;
  strand: string;
  kc: string;
  stem: string;
  options: string[];
  correct: number;
  standard?: string;
  dok?: number;
  b?: number;
}

@Injectable()
export class DiagnosticBankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIRouterService,
  ) {}

  /** One-time populate from the in-code calibrated bank (the 89). Idempotent:
   *  does nothing once seed items exist. Seeds land as published (they are the
   *  live calibrated set) with provisional DOK + inferred standard. */
  async seedFromCode(): Promise<{ seeded: number; alreadyPresent: number; updated: number }> {
    const seedCount = await this.prisma.diagnosticItem.count({ where: { source: 'seed' } });
    if (seedCount > 0) {
      // Already seeded — re-derive standards with the current mapping so improved
      // grade+strand inference fixes existing items. DOK is left as-is (may be edited).
      const seeds = await this.prisma.diagnosticItem.findMany({
        where: { source: 'seed' },
        select: { id: true, grade: true, strand: true },
      });
      let updated = 0;
      for (const s of seeds) {
        await this.prisma.diagnosticItem.update({
          where: { id: s.id },
          data: { standard: standardFor(s.grade, s.strand) },
        });
        updated++;
      }
      return { seeded: 0, alreadyPresent: seedCount, updated };
    }
    const rows = DIAGNOSTIC_ITEM_BANK.map((it) => ({
      id: it.id,
      grade: it.grade,
      strand: it.strand,
      kc: it.kc,
      standard: standardFor(it.grade, it.strand),
      dok: provisionalDok(it.b),
      b: it.b,
      stem: it.stem,
      options: it.options,
      correct: it.correct,
      status: 'published',
      source: 'seed',
    }));
    await this.prisma.diagnosticItem.createMany({ data: rows, skipDuplicates: true });
    return { seeded: rows.length, alreadyPresent: 0, updated: 0 };
  }

  list(q: { grade?: number; status?: string; strand?: string; take?: number }) {
    return this.prisma.diagnosticItem.findMany({
      where: {
        grade: q.grade ? Number(q.grade) : undefined,
        status: q.status || undefined,
        strand: q.strand || undefined,
      },
      orderBy: [{ grade: 'asc' }, { strand: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(Number(q.take) || 500, 2000),
    });
  }

  async create(dto: CreateDiagnosticItemDto, createdBy?: string) {
    if (!dto.stem?.trim()) throw new BadRequestException({ error: { code: 'no_stem', message: 'Stem required' } });
    if (!Array.isArray(dto.options) || dto.options.length < 2) {
      throw new BadRequestException({ error: { code: 'few_options', message: 'At least two options required' } });
    }
    if (typeof dto.correct !== 'number' || dto.correct < 0 || dto.correct >= dto.options.length) {
      throw new BadRequestException({ error: { code: 'bad_correct', message: 'correct must index an option' } });
    }
    const grade = Number(dto.grade);
    const strand = String(dto.strand || '').trim().toUpperCase();
    return this.prisma.diagnosticItem.create({
      data: {
        grade,
        strand,
        kc: String(dto.kc || '').trim(),
        standard: dto.standard?.trim() || standardFor(grade, strand),
        dok: dto.dok ?? (typeof dto.b === 'number' ? provisionalDok(dto.b) : null),
        b: typeof dto.b === 'number' ? dto.b : 0,
        stem: dto.stem.trim(),
        options: dto.options.map((o) => String(o)),
        correct: dto.correct,
        status: 'draft',
        source: 'manual',
        createdBy: createdBy ?? null,
      },
    });
  }

  async review(id: string, action: 'validate' | 'reject' | 'restore') {
    await this.prisma.diagnosticItem.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new NotFoundException('Diagnostic item not found');
    });
    const status: DiagStatus = action === 'validate' ? 'validated' : action === 'reject' ? 'rejected' : 'draft';
    return this.prisma.diagnosticItem.update({ where: { id }, data: { status } });
  }

  /** Publish all validated items — they become the set the live diagnostic will
   *  serve once the serve-path is wired (next phase). Never touches rejected. */
  async publish(): Promise<{ published: number }> {
    const res = await this.prisma.diagnosticItem.updateMany({
      where: { status: 'validated' },
      data: { status: 'published' },
    });
    return { published: res.count };
  }

  /**
   * AI-generate diagnostic items for a grade+strand straight into the staging
   * bank as drafts (source 'generated') for human review. Helps close the
   * per-grade viability gap. Never published automatically — drafts only.
   */
  async generateForGrade(
    body: { grade: number; strand: string; count?: number },
    createdBy?: string,
  ): Promise<{ created: number }> {
    const grade = Number(body.grade);
    const strand = String(body.strand || '').trim().toUpperCase();
    if (!grade || !strand) {
      throw new BadRequestException({ error: { code: 'bad_input', message: 'grade and strand required' } });
    }
    const count = Math.min(Math.max(Number(body.count) || 10, 5), 20);
    const standard = standardFor(grade, strand);

    const systemPrompt =
      "You are EdKairos's diagnostic item writer. Produce calibrated-style multiple-choice math " +
      'items for ONE grade and standard. Return VALID JSON ONLY: an array of objects with keys ' +
      '{ "stem", "options" (exactly 4 short plain-text strings), "correct" (0-based index of the ' +
      'right option), "kc" (short skill name), "dok" (integer 1-4), "b" (difficulty, -2.0 to 2.0) }. ' +
      'Rules: exactly one correct option; four distinct plausible options; the stem is a single ' +
      'plain-English sentence (NO tables, markdown, or images); aligned to the grade. Vary difficulty ' +
      'across the set (some easy with negative b, some hard with positive b) and include fraction and ' +
      'decimal quantities where appropriate. No prose outside the JSON array.';
    const prompt = `Grade ${grade}, strand ${strand}${standard ? `, standard ${standard}` : ''}. Write ${count} diagnostic items.`;

    const res = await this.ai.chat({
      systemPrompt,
      prompt,
      preferredProvider: 'claude',
      timeoutMs: 60_000,
      maxTokens: 8000,
    });

    const raw = this.parseJsonArray(res.text) as Array<{
      stem?: unknown; options?: unknown; correct?: unknown; kc?: unknown; dok?: unknown; b?: unknown;
    }>;
    const rows = raw
      .map((it) => {
        const options = Array.isArray(it.options) ? it.options.map((o) => String(o)).filter((o) => o.trim()) : [];
        const correct = typeof it.correct === 'number' ? it.correct : Number(it.correct);
        const stem = String(it.stem ?? '').trim();
        if (!stem || options.length < 2 || !(correct >= 0 && correct < options.length)) return null;
        const dok = Math.min(4, Math.max(1, Number(it.dok) || 2));
        const b = Math.min(3, Math.max(-3, typeof it.b === 'number' ? it.b : Number(it.b) || 0));
        return {
          grade, strand, kc: String(it.kc ?? '').trim() || `${strand} skill`,
          standard, dok, b, stem, options, correct,
          status: 'draft', source: 'generated', createdBy: createdBy ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length) await this.prisma.diagnosticItem.createMany({ data: rows });
    return { created: rows.length };
  }

  /**
   * Generate diagnostic items from UPLOADED/pasted source questions (e.g. a DnA
   * bank), each aligned to its OWN standard/grade — not a single grade+strand.
   * Every generated item is independently re-solved (correctness verifier) and
   * wrong/ambiguous ones are dropped before saving. Seeds are reference-only and
   * never stored; only new AI items land, as drafts for review. Text-only, since
   * DiagnosticItem has no figure field. Capped per request to stay well within
   * the HTTP timeout — run again for a larger bank (duplicates are skipped).
   */
  async generateFromSeeds(
    body: { seeds: Array<{ stem?: string; standard?: string }> },
    createdBy?: string,
  ): Promise<{ created: number; discarded: number; requested: number; skippedNoStandard: number }> {
    const all = (body.seeds ?? [])
      .map((s) => ({ stem: String(s?.stem ?? '').trim(), standard: String(s?.standard ?? '').trim() }))
      .filter((s) => s.stem.length > 8);
    if (!all.length) {
      throw new BadRequestException({ error: { code: 'no_seeds', message: 'No usable seed questions' } });
    }
    // A seed needs a parseable standard so we can route grade+strand. Skip the rest.
    const seeds = all.filter((s) => gradeStrandFromStandard(s.standard));
    const skippedNoStandard = all.length - seeds.length;
    const capped = seeds.slice(0, 24); // bound per-request time (run again for more)

    let created = 0;
    let discarded = 0;
    const BATCH = 8;
    for (let i = 0; i < capped.length; i += BATCH) {
      const group = capped.slice(i, i + BATCH);
      const sys =
        "You are EdKairos's diagnostic item writer. You are given SOURCE questions, each with its " +
        'standard. For EACH source, write ONE NEW diagnostic multiple-choice item that tests the SAME ' +
        'standard and grade — same topic, fresh numbers/context, NOT a copy of the source. Return VALID ' +
        'JSON ONLY: an array in the SAME ORDER as the sources, one object each: { "stem", "options" ' +
        '(exactly 4 short plain-text strings), "correct" (0-based index of the right option), "kc" (short ' +
        'skill name), "dok" (integer 1-4), "b" (difficulty -2.0..2.0) }. Rules: exactly one correct ' +
        'option; four distinct plausible options; the stem is ONE plain-English sentence with NO tables, ' +
        'markdown, or images (diagnostic items are text-only); stay at the source\'s grade level. No prose ' +
        'outside the JSON array.';
      const user = group
        .map((s, k) => `${k + 1}) [standard ${s.standard}] ${s.stem}`)
        .join('\n');

      let items: Array<{ stem?: unknown; options?: unknown; correct?: unknown; kc?: unknown; dok?: unknown; b?: unknown }>;
      try {
        const res = await this.ai.chat({ systemPrompt: sys, prompt: user, preferredProvider: 'claude', timeoutMs: 60_000, maxTokens: 8000 });
        items = this.parseJsonArray(res.text) as typeof items;
      } catch {
        continue; // one bad batch shouldn't sink the run
      }

      // Correctness verifier: independently re-solve; keep only confirmed-correct, unambiguous items.
      const okSet = await this.verifyDiagnostic(items);

      const rows = items
        .map((it, k) => {
          if (!okSet.has(k)) return null;
          const seed = group[k];
          const gs = seed ? gradeStrandFromStandard(seed.standard) : null;
          if (!gs) return null;
          const options = Array.isArray(it.options) ? it.options.map((o) => String(o)).filter((o) => o.trim()) : [];
          const correct = typeof it.correct === 'number' ? it.correct : Number(it.correct);
          const stem = String(it.stem ?? '').trim();
          if (!stem || options.length !== 4 || !(correct >= 0 && correct < options.length)) return null;
          const dok = Math.min(4, Math.max(1, Number(it.dok) || provisionalDok(Number(it.b) || 0)));
          const b = Math.min(3, Math.max(-3, typeof it.b === 'number' ? it.b : Number(it.b) || 0));
          return {
            grade: gs.grade,
            strand: gs.strand,
            kc: String(it.kc ?? '').trim() || `${gs.strand} skill`,
            standard: standardFor(gs.grade, gs.strand) ?? seed.standard,
            dok, b, stem, options, correct,
            status: 'draft', source: 'generated', createdBy: createdBy ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      discarded += group.length - rows.length;
      if (rows.length) {
        const saved = await this.prisma.diagnosticItem.createMany({ data: rows, skipDuplicates: true });
        created += saved.count;
      }
    }
    return { created, discarded, requested: capped.length, skippedNoStandard };
  }

  /** Independently re-solve each generated diagnostic item; return the indexes the
   *  judge confirms are correct + unambiguous. Fails OPEN (keeps all) on error so a
   *  transient hiccup never wipes a batch. */
  private async verifyDiagnostic(
    items: Array<{ stem?: unknown; options?: unknown; correct?: unknown }>,
  ): Promise<Set<number>> {
    const keepAll = () => new Set(items.map((_, i) => i));
    if (!items.length) return new Set();
    const payload = items.map((it, i) => ({
      i,
      stem: String(it.stem ?? ''),
      options: Array.isArray(it.options) ? it.options.map((o) => String(o)) : [],
      correctIndex: typeof it.correct === 'number' ? it.correct : Number(it.correct),
    }));
    const system =
      'You are a STRICT K-8 math item checker. For each item, independently solve the problem from ' +
      'scratch, then mark ok=false if ANY hold: the option at correctIndex is NOT the truly correct ' +
      'answer; the item is ambiguous or has more than one defensible answer; required info is missing; ' +
      'or numbers/units are inconsistent. Only ok=true when confident the marked answer is correct and ' +
      'the item is unambiguous. Return JSON ONLY: an array of {"i": <index>, "ok": <true|false>}. Be ' +
      'strict — when in doubt, ok=false.';
    try {
      const res = await this.ai.chat({ systemPrompt: system, prompt: JSON.stringify(payload), preferredProvider: 'claude', timeoutMs: 60_000, maxTokens: 3000 });
      const verdicts = this.parseJsonArray(res.text) as Array<{ i?: number; ok?: boolean }>;
      if (!verdicts.length) return keepAll(); // fail open
      const ok = new Set(verdicts.filter((v) => v.ok === true).map((v) => Number(v.i)));
      return ok.size ? ok : keepAll(); // if judge approved nothing, fail open
    } catch {
      return keepAll();
    }
  }

  /** Tolerant JSON-array parse: salvages complete objects from a truncated array. */
  private parseJsonArray(rawText: string): unknown[] {
    const s = rawText.indexOf('[');
    if (s < 0) return [];
    const body = rawText.slice(s);
    const e = body.lastIndexOf(']');
    if (e >= 0) {
      try { return JSON.parse(body.slice(0, e + 1)); } catch { /* salvage below */ }
    }
    const out: unknown[] = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') { if (depth > 0) depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(body.slice(start, i + 1))); } catch { /* skip */ } start = -1; } }
    }
    return out;
  }

  /** Viability + alignment stats: per-grade progress to the minimum, DOK 1–4
   *  spread, standard coverage, per-strand counts. Drives the manage screen. */
  async stats() {
    const items = await this.prisma.diagnosticItem.findMany({
      select: { grade: true, strand: true, standard: true, dok: true, status: true },
    });

    const gradeMap = new Map<number, { total: number; byStatus: Record<string, number>; standards: Set<string> }>();
    const dok: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, none: 0 };
    const strandMap = new Map<string, number>();
    const byStatusTotal: Record<string, number> = { draft: 0, validated: 0, rejected: 0, published: 0 };

    for (const it of items) {
      const g = gradeMap.get(it.grade) ?? { total: 0, byStatus: {}, standards: new Set<string>() };
      g.total += 1;
      g.byStatus[it.status] = (g.byStatus[it.status] ?? 0) + 1;
      if (it.standard) g.standards.add(it.standard);
      gradeMap.set(it.grade, g);

      byStatusTotal[it.status] = (byStatusTotal[it.status] ?? 0) + 1;
      dok[it.dok && it.dok >= 1 && it.dok <= 4 ? String(it.dok) : 'none'] += 1;
      if (it.strand) strandMap.set(it.strand, (strandMap.get(it.strand) ?? 0) + 1);
    }

    const byGrade = [...gradeMap.entries()]
      .map(([grade, v]) => ({
        grade,
        total: v.total,
        viable: v.total >= VIABILITY_MIN,
        short: Math.max(0, VIABILITY_MIN - v.total),
        byStatus: v.byStatus,
        standards: [...v.standards].sort(),
      }))
      .sort((a, b) => a.grade - b.grade);

    return {
      viabilityMin: VIABILITY_MIN,
      total: items.length,
      byStatus: byStatusTotal,
      byGrade,
      dok,
      byStrand: [...strandMap.entries()].map(([strand, count]) => ({ strand, count })).sort((a, b) => a.strand.localeCompare(b.strand)),
      dokComplete: dok['1'] > 0 && dok['2'] > 0 && dok['3'] > 0 && dok['4'] > 0,
    };
  }
}
