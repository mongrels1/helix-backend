import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { isPlanActive } from '../../common/billing/billing';
import { coveringParent, loadFamilyLinksFor } from '../../common/family/family';
import { productFor } from '../../common/product/product';
import {
  SCORE_EXTRACTION_SYSTEM,
  buildExtractionPrompt,
  buildVisionExtractionPrompt,
  extractJson,
} from './push-map.prompt';
import { REACH_BY_PRODUCT, composePushMap, strandForVendorDomain } from './push-map.tracks';
import type { PushMap, ScoreExtraction } from './push-map.types';

interface PushMapJob {
  id: string;
  ownerId: string;
  studentId?: string;
  note?: string;
  extraction?: ScoreExtraction;
  map?: PushMap;
  createdAt: number;
}

const EMPTY_EXTRACTION: ScoreExtraction = {
  vendor: 'UNKNOWN',
  assessmentName: null,
  takenOn: null,
  studentGrade: null,
  overall: { score: null, label: null, standardError: null },
  percentile: null,
  domains: [],
  growthTargets: { typical: null, stretch: null },
  unreadable: [],
};

/**
 * The Push Map builder.
 *
 *   upload → extract (AI, transcription only) → CONFIRM (human) → compose (pure)
 *
 * The only model call is the transcription, and nothing it returns reaches a
 * parent without a person having looked at it on the confirm screen. Everything
 * after that is deterministic, so the same confirmed numbers always produce the
 * same plan.
 *
 * v1 persistence is in-memory, matching LessonPlanService. **This should become a
 * table before long** — a Push Map is the baseline the next one diffs against,
 * and that diff ("since August, he moved from Strengthen to Push in Measurement
 * and Data") is the "prove the gain" half of the product. History we never wrote
 * down cannot be recovered later.
 */
@Injectable()
export class PushMapService {
  private readonly logger = new Logger(PushMapService.name);
  private readonly jobs = new Map<string, PushMapJob>();
  private readonly ttlMs = 6 * 60 * 60 * 1000;

  constructor(
    private readonly ai: AIRouterService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  createJob(ownerId: string): { jobId: string } {
    this.sweep();
    const id = randomUUID().slice(0, 12);
    this.jobs.set(id, { id, ownerId, createdAt: Date.now() });
    return { jobId: id };
  }

  private get(jobId: string, ownerId: string): PushMapJob {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId) throw new NotFoundException('job not found');
    return job;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) if (job.createdAt < cutoff) this.jobs.delete(id);
  }

  /**
   * Transcribe an uploaded report.
   *
   * Two ways in, and the second is the common one:
   *
   * - **text** — the PDF had a text layer, pulled client-side by
   *   `lib/pdfExtract.ts`. Cheap and exact.
   * - **page images** — it did not. Schools overwhelmingly hand out
   *   printed-then-scanned PDFs, so a builder that only reads text layers is a
   *   builder that fails on most real reports. The pages are rendered to JPEG in
   *   the browser and read by `claudeVision`.
   *
   * Either way the work happens in the browser and only the derived text or
   * images are posted. The original document never reaches our servers — a
   * child's score report is about as sensitive as school data gets, and the
   * least we can hold is none of it.
   */
  async extract(
    jobId: string,
    ownerId: string,
    input: { reportText?: string; pageImages?: string[]; note?: string },
  ): Promise<ScoreExtraction> {
    const job = this.get(jobId, ownerId);
    const text = (input.reportText ?? '').trim();
    const images = (input.pageImages ?? [])
      .map((raw) => decodeDataUrl(raw))
      .filter((img): img is { base64: string; mediaType: string } => img !== null);

    let reply: string;
    let via: string;

    if (text.length >= MIN_REPORT_TEXT) {
      const ai = await this.ai.chat({
        prompt: buildExtractionPrompt(text, input.note),
        systemPrompt: SCORE_EXTRACTION_SYSTEM,
        preferredProvider: 'claude',
        maxTokens: 2000,
        temperature: 0,
        timeoutMs: 60_000,
      });
      reply = ai.text;
      via = `text/${ai.provider}`;
    } else if (images.length > 0) {
      // `claudeVision` sits outside the provider fallback chain by design, and
      // it falls back to its own default model if the configured one fails.
      // Reading a child's scores off a scan is the single place in this feature
      // where model quality maps directly to a wrong plan, so the model is
      // overridable per-environment rather than pinned in code.
      reply = await this.ai.claudeVision({
        text: buildVisionExtractionPrompt(input.note),
        images,
        systemPrompt: SCORE_EXTRACTION_SYSTEM,
        maxTokens: 2000,
        // Several full pages take appreciably longer than a text call.
        timeoutMs: 120_000,
        model: this.config.get<string>('pushMap.visionModel') || undefined,
      });
      via = `vision/${images.length}p`;
    } else {
      throw new BadRequestException(
        'There was nothing readable in that file. Paste the text, or type the scores in by hand on the next screen.',
      );
    }

    const parsed = extractJson<Partial<ScoreExtraction>>(reply);
    if (!parsed) {
      this.logger.warn(`Push Map extraction returned no JSON (${via})`);
      // Not an error the family should see as a failure — the confirm screen can
      // be filled in by hand, which is the whole reason it exists.
      job.extraction = { ...EMPTY_EXTRACTION, unreadable: ['everything — please enter by hand'] };
      return job.extraction;
    }

    job.note = input.note;
    job.extraction = this.normalize(parsed);
    this.logger.log(
      `Push Map extraction ${via}: vendor=${job.extraction.vendor} ` +
        `domains=${job.extraction.domains.length} unreadable=${job.extraction.unreadable.length}`,
    );
    return job.extraction;
  }

  /** Coerce a model reply into the contract, dropping anything malformed. */
  private normalize(raw: Partial<ScoreExtraction>): ScoreExtraction {
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null;

    const domains = Array.isArray(raw.domains)
      ? raw.domains
          .filter((d) => d && typeof d.name === 'string' && d.name.trim())
          .map((d) => ({
            name: d.name.trim(),
            score: num(d.score),
            label: str(d.label),
            strand: strandForVendorDomain(d.name),
          }))
      : [];

    const unreadable = Array.isArray(raw.unreadable)
      ? raw.unreadable.filter((u): u is string => typeof u === 'string')
      : [];

    // Anything the contract requires but the model left empty is added to
    // `unreadable` here rather than silently defaulted, so the confirm screen
    // always shows the human what is missing.
    const overall = {
      score: num(raw.overall?.score),
      label: str(raw.overall?.label),
      standardError: num(raw.overall?.standardError),
    };
    if (overall.score === null && !unreadable.includes('overall score')) {
      unreadable.push('overall score');
    }
    if (domains.length === 0 && !unreadable.includes('domain scores')) {
      unreadable.push('domain scores');
    }

    return {
      vendor: (['IREADY', 'MAP_GROWTH', 'STAR', 'GA_MILESTONES'] as const).includes(
        raw.vendor as never,
      )
        ? (raw.vendor as ScoreExtraction['vendor'])
        : 'UNKNOWN',
      assessmentName: str(raw.assessmentName),
      takenOn: str(raw.takenOn),
      studentGrade: num(raw.studentGrade),
      overall,
      percentile: num(raw.percentile),
      domains,
      growthTargets: {
        typical: num(raw.growthTargets?.typical),
        stretch: num(raw.growthTargets?.stretch),
      },
      unreadable,
    };
  }

  /** Replace the extraction with what the human confirmed on screen 2. */
  setExtraction(jobId: string, ownerId: string, extraction: ScoreExtraction): ScoreExtraction {
    const job = this.get(jobId, ownerId);
    job.extraction = {
      ...extraction,
      domains: (extraction.domains ?? []).map((d) => ({
        ...d,
        strand: d.strand ?? strandForVendorDomain(d.name),
      })),
    };
    return job.extraction;
  }

  /**
   * Build the map.
   *
   * `reach` comes from the student's product, so how far above grade the plan
   * pushes is the tier's differentiator — resolved through the same catalogue
   * the admin list and the ribbon read, never re-derived here.
   */
  async generate(jobId: string, ownerId: string, studentId: string): Promise<PushMap> {
    const job = this.get(jobId, ownerId);
    if (!job.extraction) throw new BadRequestException('Nothing has been read yet.');

    const student = await this.prisma.user.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
        planStatus: true,
        planRenewsAt: true,
        planSource: true,
        profile: { select: { firstName: true, lastName: true, grade: true } },
      },
    });
    if (!student) throw new NotFoundException('Student not found');

    // A scholar's product lives on the parent paying for them — the same rule
    // the ribbon and the admin list use.
    const family = await loadFamilyLinksFor(this.prisma, studentId);
    const payer = coveringParent(family);
    const product = payer
      ? productFor(payer.plan, null, true)
      : productFor(
          student.plan,
          student.planSource,
          isPlanActive(student.planStatus, student.planRenewsAt),
          student.role,
        );

    const name =
      `${student.profile?.firstName ?? ''} ${student.profile?.lastName ?? ''}`.trim() ||
      student.email;

    // The enrolled grade on file wins over the one printed on the report only
    // when the report does not state one — the report is the primary source,
    // since `profile.grade` is a free-text field somebody typed at signup.
    const extraction: ScoreExtraction = {
      ...job.extraction,
      studentGrade:
        job.extraction.studentGrade ?? parseGrade(student.profile?.grade ?? null),
    };

    const map = composePushMap(name, extraction, {
      reach: REACH_BY_PRODUCT[product.id] ?? 1,
    });
    job.studentId = studentId;
    job.map = map;
    this.logger.log(
      `Push Map built for ${studentId} (${product.id}, reach=${REACH_BY_PRODUCT[product.id] ?? 1}): ` +
        `${map.push.length} push, ${map.strengthen.length} strengthen`,
    );
    return map;
  }

  getMap(jobId: string, ownerId: string): PushMap {
    const job = this.get(jobId, ownerId);
    if (!job.map) throw new NotFoundException('No Push Map has been built for this job.');
    return job.map;
  }

  /**
   * Who the map is for.
   *
   * A narrow search rather than paging `GET /api/v1/users`: that endpoint
   * returns every field of every account 20 at a time, and this screen needs
   * three columns of scholars only. Capped at 25 so a blank box cannot be used
   * to walk the roster.
   */
  async searchStudents(
    query: string,
  ): Promise<{ id: string; name: string; email: string; grade: string | null }[]> {
    const q = (query ?? '').trim();
    const contains = { contains: q, mode: 'insensitive' as const };
    const rows = await this.prisma.user.findMany({
      where: {
        role: 'STUDENT',
        deletedAt: null,
        ...(q
          ? {
              OR: [
                { email: contains },
                { profile: { firstName: contains } },
                { profile: { lastName: contains } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        profile: { select: { firstName: true, lastName: true, grade: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 25,
    });

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name:
        `${r.profile?.firstName ?? ''} ${r.profile?.lastName ?? ''}`.trim() || r.email,
      grade: r.profile?.grade ?? null,
    }));
  }
}

/**
 * Below this, a "text layer" is page furniture — a header, a page number — not a
 * report. Falling through to vision on a near-empty text layer is right: a PDF
 * that is a scan with a letterhead typed over it reads as 20 characters here.
 */
const MIN_REPORT_TEXT = 40;

/** The image types the Anthropic API accepts. Anything else is dropped. */
const VISION_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/**
 * `data:image/jpeg;base64,…` → what `claudeVision` wants.
 *
 * Returns null rather than throwing for anything malformed or of a type the API
 * will not take. A single bad page should cost that page, not the whole upload —
 * and `extract` already handles ending up with no usable images at all.
 */
function decodeDataUrl(raw: string): { base64: string; mediaType: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec((raw ?? '').trim());
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (!VISION_MEDIA_TYPES.has(mediaType)) return null;
  if (!m[2] || m[2].length < 100) return null;
  return { base64: m[2], mediaType };
}

/** "4", "Grade 4", "4th" → 4. K → 0. Anything else → null. */
function parseGrade(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s === 'K' || s.startsWith('KINDER')) return 0;
  const m = s.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 && n <= 12 ? n : null;
}
