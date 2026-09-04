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
  buildLessonPlanPrompt,
  extractJson,
  LESSON_PLAN_SYSTEM,
  PlanConfig,
} from './lesson-plan.prompt';
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
  provider: string;
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

  async generate(jobId: string, teacherId: string, dto: GeneratePlanDto) {
    const job = this.get(jobId, teacherId);
    if (!job.template) throw new BadRequestException('upload a template first');
    if (!dto.periodMinutes) {
      throw new BadRequestException('periodMinutes is required (How long is the period?)');
    }

    // assemble resource context, ILP/pacing first
    const order: Record<string, number> = {
      ilp: 0, pacing: 1, standards: 2, perf_task: 3, roster: 4, slides: 5, other: 6,
    };
    const resourcesText = [...job.resources]
      .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))
      .map((r) => `=== ${r.filename} [${r.type}] ===\n${r.text}`)
      .join('\n\n');

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

    // 1) draft the content, one day per call.
    //
    // A whole week in a single reply is days x segments x nine prose fields,
    // doubled again when co-teaching splits teacher_actions by role. It was
    // landing on the 8000-token ceiling and being clipped mid-JSON; raising the
    // ceiling only made the reply take long enough that the connection died
    // before it arrived. Both are the same problem — one request carrying too
    // much — and asking for one day at a time removes it rather than moving it.
    //
    // Each day is its own small, fast call, and they run together, so a five-day
    // week with four differentiation groups costs no more wall-clock than a
    // two-day one. The prompt is unchanged: it already takes the day list, so
    // passing a list of one asks for exactly one day.
    const qualityModel = this.config.get<string>('lessonPlan.claudeModel') || undefined;

    const drafted: DayDraft[] = (
      await Promise.all(
        (dto.days ?? []).map(async (day): Promise<DayDraft | null> => {
          const ai = await this.ai.chat({
            prompt: buildLessonPlanPrompt({ ...cfg, days: [day] }, resourcesText),
            systemPrompt: LESSON_PLAN_SYSTEM,
            preferredProvider: 'claude',
            claudeModel: qualityModel,
            // One day of segments is ~1500-2500 tokens. 6000 is headroom, and
            // well inside the SDK non-streaming ceiling whatever the model.
            maxTokens: 6000,
            temperature: 0.4,
            timeoutMs: 120000,
          });

          const parsed = extractJson(ai.text) as { days?: unknown; small_group?: unknown } | null;
          const days = parsed?.days;
          if (!Array.isArray(days) || days.length === 0) {
            const text = ai.text ?? '';
            this.logger.error(
              `lesson plan day "${day}" unusable — provider=${ai.provider} ` +
                `stopReason=${ai.stopReason ?? 'n/a'} chars=${text.length} ` +
                `tokens=${ai.tokensUsed} segmentsPerDay=${dto.segmentsPerDay} ` +
                `groups=${(dto.differentiationGroups ?? []).length}`,
            );
            this.logger.error(`lesson plan day "${day}" tail: ${JSON.stringify(text.slice(-400))}`);
            return null;
          }

          return { days, smallGroup: parsed?.small_group, provider: ai.provider };
        }),
      )
    ).filter((d): d is DayDraft => d !== null);

    if (drafted.length === 0) {
      throw new BadRequestException('generation did not return a usable plan; try again');
    }
    if (drafted.length < (dto.days ?? []).length) {
      // Better a plan the teacher can see is short than no plan at all — but say so.
      this.logger.warn(`lesson plan drafted ${drafted.length} of ${(dto.days ?? []).length} days`);
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
      dates: dto.week,
    });

    return {
      engine: drafted[0].provider,
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
