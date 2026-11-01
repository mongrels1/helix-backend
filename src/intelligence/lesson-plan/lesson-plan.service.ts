import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AIRouterService } from '../ai-router/ai-router.service';
import {
  ExtractedResource,
  LessonPlanSidecarService,
  TemplateFieldMap,
  UploadedFile,
} from './lesson-plan.sidecar';
import {
  buildIldDayPrompt,
  buildLessonDayPrompt,
  buildSharedContext,
  extractJson,
  LESSON_PLAN_SYSTEM,
  PlanConfig,
  RESOURCE_CHAR_LIMIT,
} from './lesson-plan.prompt';
import { ildNotes, normaliseClassDay, weekRoles } from './lesson-plan.quality';
import {
  DaySuggestion,
  failedDay,
  formatWeekRange,
  ildDay,
  IldDraft,
  ildUsable,
  noSchoolDay,
  ResolvedDay,
  resolveDays,
  statusNote,
  suggestDayStatuses,
  weekOverview,
} from './lesson-plan.days';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { patchDocxHeader } from './lesson-plan.docx-header';

interface LessonPlanJob {
  id: string;
  teacherId: string;
  template?: { file: UploadedFile; fieldMap: TemplateFieldMap };
  resources: ExtractedResource[];
  docx?: Buffer;
  createdAt: number;
}

/**
 * Orchestrates weekly math lesson-plan generation.
 *   template + resources  → (sidecar parse/extract)
 *   generate              → AIRouterService.chat(claude) drafts content
 *                            → sidecar /fill applies pacing + structure-locked fill
 *
 * v1 persistence is in-memory (see PORT_NOTES.md for the Prisma LessonPlanJob
 * model + R2 artifact storage to swap in for production).
 */
/** One day's worth of drafted plan, plus which provider produced it. */
interface DayDraft {
  days: unknown[];
  smallGroup?: unknown;
  /** null when no AI call was made (a no-school day) or the call failed. */
  provider: string | null;
  tokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}

@Injectable()
export class LessonPlanService {
  private readonly logger = new Logger(LessonPlanService.name);
  private readonly jobs = new Map<string, LessonPlanJob>();
  private readonly ttlMs = 6 * 60 * 60 * 1000;

  constructor(
    private readonly ai: AIRouterService,
    private readonly sidecar: LessonPlanSidecarService,
    private readonly config: ConfigService,
  ) {}

  createJob(teacherId: string): { jobId: string } {
    this.sweep();
    const id = randomUUID().slice(0, 12);
    this.jobs.set(id, { id, teacherId, resources: [], createdAt: Date.now() });
    return { jobId: id };
  }

  private get(jobId: string, teacherId: string): LessonPlanJob {
    const job = this.jobs.get(jobId);
    if (!job || job.teacherId !== teacherId) throw new NotFoundException('job not found');
    return job;
  }

  async setTemplate(
    jobId: string,
    teacherId: string,
    file: UploadedFile,
  ): Promise<TemplateFieldMap> {
    const job = this.get(jobId, teacherId);
    if (!/\.(docx|dotx)$/i.test(file.originalname)) {
      throw new BadRequestException('template must be .docx or .dotx');
    }
    const fieldMap = await this.sidecar.parseTemplate(file);
    job.template = { file, fieldMap };
    return fieldMap;
  }

  async addResources(
    jobId: string,
    teacherId: string,
    files: UploadedFile[],
  ): Promise<Omit<ExtractedResource, 'text'>[]> {
    const job = this.get(jobId, teacherId);
    const extracted = await this.sidecar.extract(files);
    job.resources.push(...extracted);
    return extracted.map(({ text: _text, ...rest }) => rest);
  }

  /** Resources in the order the prompt uses them: ILP and pacing first. */
  private resourcesText(job: LessonPlanJob): string {
    const order: Record<string, number> = {
      ilp: 0, pacing: 1, standards: 2, perf_task: 3, roster: 4, slides: 5, other: 6,
    };
    return [...job.resources]
      .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))
      .map((r) => `=== ${r.filename} [${r.type}] ===\n${r.text}`)
      .join('\n\n');
  }

  /**
   * Which uploads lose text to the resource limit (R7), in prompt order. The
   * teacher is told, instead of the end of a pacing guide silently vanishing.
   */
  private trimmedResources(job: LessonPlanJob): string[] {
    const order: Record<string, number> = {
      ilp: 0, pacing: 1, standards: 2, perf_task: 3, roster: 4, slides: 5, other: 6,
    };
    let used = 0;
    const cut: string[] = [];
    for (const r of [...job.resources].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))) {
      used += `=== ${r.filename} [${r.type}] ===\n`.length + r.text.length;
      if (used > RESOURCE_CHAR_LIMIT) cut.push(r.filename);
      used += 2;
    }
    return cut;
  }

  /**
   * Days the teacher's own uploads mark as an ILD or a closure, for the
   * teacher to confirm before generating. A regex over text already
   * extracted: no AI call, no cost.
   */
  suggestDays(jobId: string, teacherId: string, days: string[], weekStart: string): DaySuggestion[] {
    const job = this.get(jobId, teacherId);
    return suggestDayStatuses(days, weekStart, job.resources.map((r) => r.text).join('\n'));
  }

  async generate(jobId: string, teacherId: string, dto: GeneratePlanDto) {
    const job = this.get(jobId, teacherId);
    if (!job.template) throw new BadRequestException('upload a template first');
    if (!dto.periodMinutes) {
      throw new BadRequestException('periodMinutes is required (How long is the period?)');
    }

    const resourcesText = this.resourcesText(job);

    const cfg: PlanConfig = {
      period_minutes: dto.periodMinutes,
      grade: dto.grade,
      unit: dto.unit,
      week: dto.week,
      teacher: dto.teacher,
      co_teaching: dto.coTeaching,
      days: dto.days,
      segments_per_day: dto.segmentsPerDay,
      differentiation_groups: dto.differentiationGroups,
      strategies: dto.strategies,
      instructions: dto.instructions,
    };

    // Each template day with its status and date (Track LP1). Old clients send
    // only `days`, which resolves to every day being a teaching day.
    const resolved = resolveDays(dto.days ?? [], dto.dayPlan, dto.weekStart);
    const overview = resolved.some((r) => r.status !== 'teach' || r.date)
      ? weekOverview(resolved)
      : undefined;

    // 1) draft the content, one day per call.
    //
    // A whole week in a single reply is days x segments x nine prose fields,
    // doubled again when co-teaching splits teacher_actions by role. It was
    // landing on the 8000-token ceiling and being clipped mid-JSON; raising the
    // ceiling only made the reply take long enough that the connection died
    // before it arrived. Both are the same problem — one request carrying too
    // much — and asking for one day at a time removes it rather than moving it.
    //
    // Each day is its own small, fast call, and they run together. Since LP1:
    // - a no-school day makes no call at all;
    // - an independent-learning day makes one short call (directions,
    //   assignment, answer key) instead of a full lesson;
    // - every day keeps its position, because the sidecar fill is positional:
    //   a day that fails is replaced by a visible placeholder, never dropped
    //   (dropping one used to slide every later day into the wrong column).
    // Since LP4 each class day is told its place in the week's arc, and writes
    // the misconceptions, a worked example and practice for the notes page.
    const qualityModel = this.config.get<string>('lessonPlan.claudeModel') || undefined;
    const segs = dto.segmentsPerDay;
    const roles = weekRoles(resolved);

    // LP3 (R5): the class context and resources are identical for every day,
    // so they travel first as one shared block. Caching it only pays when the
    // block clears the model's cache minimum AND a later call reads it — a
    // cache write costs 25% more than plain input — so then one day goes
    // first and the rest follow in parallel. Below the minimum (the usual case
    // with the 12,000-character resource limit on Haiku) nothing is cached and
    // every day runs at once, exactly as before.
    const shared = buildSharedContext(cfg, resourcesText);
    const cacheMin = Number(this.config.get<string>('lessonPlan.cacheMinTokens') ?? 4096) || 4096;
    const sharedTokens = Math.ceil((shared.length + LESSON_PLAN_SYSTEM.length) / 3.5);
    const callable = resolved.filter((r) => r.status !== 'no_school');
    const useCache = callable.length >= 2 && sharedTokens >= cacheMin;

    const draftOne = async (r: ResolvedDay, i: number): Promise<DayDraft> => {
      if (r.status === 'no_school') {
        return { days: [noSchoolDay(r, segs)], provider: null, tokens: 0 };
      }
      const isIld = r.status === 'ild';
      const prompt = isIld
        ? buildIldDayPrompt({ ...cfg, days: [r.name] }, {
            name: r.name,
            reason: r.reason,
            dateLabel: r.dateLabel,
            weekOverview: overview,
          })
        : buildLessonDayPrompt({ ...cfg, days: [r.name] }, {
            dateLabel: r.dateLabel,
            weekOverview: overview,
            statusNote: statusNote(r),
            ...roles[i],
          });
      const ai = await this.ai.chat({
        prompt,
        sharedPrefix: shared,
        cachePrefix: useCache,
        systemPrompt: LESSON_PLAN_SYSTEM,
        preferredProvider: 'claude',
        claudeModel: qualityModel,
        // One day of segments is ~1500-2500 tokens, plus ~600 for the notes
        // page fields. 6000 is headroom, and well inside the SDK non-streaming
        // ceiling whatever the model. An ILD reply is a fraction of that.
        maxTokens: isIld ? 2500 : 6000,
        temperature: 0.4,
        timeoutMs: 120000,
      });
      const tokens = ai.tokensUsed ?? 0;
      const cache = { cacheRead: ai.cacheReadTokens ?? 0, cacheWrite: ai.cacheWriteTokens ?? 0 };
      const parsed = extractJson(ai.text) as (IldDraft & { days?: unknown; small_group?: unknown }) | null;

      if (isIld) {
        if (!ildUsable(parsed)) {
          this.logger.error(`lesson plan ILD day "${r.name}" unusable — provider=${ai.provider} chars=${(ai.text ?? '').length}`);
          return { days: [failedDay(r, segs)], provider: null, tokens, ...cache };
        }
        const day = ildDay(r, parsed, segs);
        return {
          days: [{ ...day, teacher_notes: ildNotes(day.segments[0].assessment_strategies) }],
          provider: ai.provider,
          tokens,
          ...cache,
        };
      }

      const days = parsed?.days;
      if (!Array.isArray(days) || days.length === 0) {
        const text = ai.text ?? '';
        this.logger.error(
          `lesson plan day "${r.name}" unusable — provider=${ai.provider} ` +
            `stopReason=${ai.stopReason ?? 'n/a'} chars=${text.length} ` +
            `tokens=${ai.tokensUsed} segmentsPerDay=${dto.segmentsPerDay} ` +
            `groups=${(dto.differentiationGroups ?? []).length}`,
        );
        this.logger.error(`lesson plan day "${r.name}" tail: ${JSON.stringify(text.slice(-400))}`);
        return { days: [failedDay(r, segs)], provider: null, tokens, ...cache };
      }
      // One day asked for, one day kept, stamped with its status for the
      // sidecar, with the notes-page fields gathered and the answers checked.
      const day = normaliseClassDay({ ...(days[0] as Record<string, unknown>), name: r.name, status: r.status });
      return { days: [day], smallGroup: parsed?.small_group, provider: ai.provider, tokens, ...cache };
    };

    const safe = (r: ResolvedDay, i: number) =>
      draftOne(r, i).catch((err: unknown) => {
        this.logger.error(`lesson plan day "${r.name}" threw: ${(err as Error)?.message ?? err}`);
        return { days: [failedDay(r, segs)], provider: null, tokens: 0 } as DayDraft;
      });

    let drafted: DayDraft[];
    if (useCache) {
      // Warm the cache with the first callable day, then the rest together.
      const first = resolved.findIndex((r) => r.status !== 'no_school');
      const warm = await safe(resolved[first], first);
      const rest = await Promise.all(resolved.map((r, i) => (i === first ? Promise.resolve(warm) : safe(r, i))));
      drafted = rest;
    } else {
      drafted = await Promise.all(resolved.map((r, i) => safe(r, i)));
    }

    const aiCalls = resolved.filter((r) => r.status !== 'no_school').length;
    const produced = drafted.filter((d) => d.provider !== null).length;
    if (aiCalls > 0 && produced === 0) {
      throw new BadRequestException('generation did not return a usable plan; try again');
    }
    if (produced < aiCalls) {
      // Better a plan the teacher can see is short than no plan at all — but say so.
      this.logger.warn(`lesson plan drafted ${produced} of ${aiCalls} days`);
    }

    // Days keep the order they were asked for. small_group is a week-level
    // section, so take the first one any day produced.
    const plan = {
      days: drafted.flatMap((d) => d.days),
      small_group: drafted.find((d) => Array.isArray(d.smallGroup))?.smallGroup ?? [],
    };

    // 2) deterministic pacing + structure-locked fill (sidecar)
    const fill = await this.sidecar.fill({
      template: job.template.file,
      plan,
      periodMinutes: dto.periodMinutes,
      segmentsPerDay: dto.segmentsPerDay,
      differentiationGroups: dto.differentiationGroups,
    });
    // sidecar fills the body grid but not the template header; write the
    // Step-3 header fields (School/Teachers/Grade/Unit/Dates) in-process.
    job.docx = await patchDocxHeader(fill.docx, {
      school: dto.school,
      teacher: dto.teacher,
      grade: dto.grade,
      unit: dto.unit,
      // The teacher's own wording wins; otherwise the dates from the week start.
      dates: dto.week?.trim() || formatWeekRange(resolved),
    });

    return {
      engine: drafted.find((d) => d.provider)?.provider ?? 'none',
      aiCalls,
      tokensUsed: drafted.reduce((n, d) => n + d.tokens, 0),
      cache: {
        used: useCache,
        readTokens: drafted.reduce((n, d) => n + (d.cacheRead ?? 0), 0),
        writeTokens: drafted.reduce((n, d) => n + (d.cacheWrite ?? 0), 0),
      },
      // R7: uploads that lost text to the resource limit.
      resourcesTrimmed: this.trimmedResources(job),
      days: resolved.map(({ name, status, date }) => ({ name, status, date })),
      structureLocked: fill.structureLocked,
      pacingOk: fill.pacingOk,
      periodMinutes: dto.periodMinutes,
      summary: fill.summary,
      download: `/api/v1/lesson-plan/jobs/${jobId}/plan.docx`,
    };
  }

  getDocx(jobId: string, teacherId: string): { buffer: Buffer; filename: string } {
    const job = this.get(jobId, teacherId);
    if (!job.docx) throw new NotFoundException('no generated plan yet');
    const base = job.template?.file.originalname.replace(/\.(docx|dotx)$/i, '') ?? 'Lesson_Plan';
    return { buffer: job.docx, filename: `${base} - FILLED.docx` };
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff) this.jobs.delete(id);
    }
  }
}
