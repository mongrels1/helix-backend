import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Copy a Node Buffer into a standard-ArrayBuffer-backed Uint8Array so it is a
 *  valid BlobPart under strict TS (avoids the Buffer<ArrayBufferLike> error). */
function bufToBlob(buf: Buffer): Blob {
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return new Blob([bytes]);
}

/**
 * Thin HTTP client for lesson-plan-svc (the deterministic Python docx sidecar).
 * All calls carry the shared secret so only helix-backend can reach it.
 *
 * Config:
 *   LESSON_PLAN_SVC_URL     e.g. http://lesson-plan-svc.railway.internal:8000
 *   LESSON_PLAN_SVC_SECRET  must equal the sidecar's SIDECAR_SECRET
 */
export interface TemplateFieldMap {
  days: string[];
  num_tables: number;
  segments_per_day: number;
  lesson_component_dropdowns: number;
  differentiation_dropdowns: number;
  fields_per_day: string[];
  fields_per_segment: string[];
  has_small_group_table: boolean;
}

export interface ExtractedResource {
  filename: string;
  type: string;
  detected: string;
  chars: number;
  text: string;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

export interface FillResult {
  docx: Buffer;
  structureLocked: boolean;
  pacingOk: boolean;
  summary: unknown;
}

@Injectable()
export class LessonPlanSidecarService {
  private readonly logger = new Logger(LessonPlanSidecarService.name);
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('lessonPlan.svcUrl') ?? '').replace(/\/$/, '');
    this.secret = this.config.get<string>('lessonPlan.svcSecret') ?? '';
  }

  private headers(): Record<string, string> {
    return { 'X-Sidecar-Secret': this.secret };
  }

  private assertConfigured(): void {
    if (!this.baseUrl || !this.secret) {
      throw new InternalServerErrorException(
        'lesson-plan-svc is not configured (LESSON_PLAN_SVC_URL / LESSON_PLAN_SVC_SECRET)',
      );
    }
  }

  async parseTemplate(file: UploadedFile): Promise<TemplateFieldMap> {
    this.assertConfigured();
    const form = new FormData();
    form.append('file', bufToBlob(file.buffer), file.originalname);
    const res = await fetch(`${this.baseUrl}/parse-template`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) throw new InternalServerErrorException(`sidecar parse-template ${res.status}`);
    const json = (await res.json()) as { fieldMap: TemplateFieldMap };
    return json.fieldMap;
  }

  async extract(files: UploadedFile[]): Promise<ExtractedResource[]> {
    this.assertConfigured();
    const form = new FormData();
    for (const f of files) form.append('files', bufToBlob(f.buffer), f.originalname);
    const res = await fetch(`${this.baseUrl}/extract`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) throw new InternalServerErrorException(`sidecar extract ${res.status}`);
    const json = (await res.json()) as { resources: ExtractedResource[] };
    return json.resources;
  }

  async fill(opts: {
    template: UploadedFile;
    plan: unknown;
    periodMinutes: number;
    segmentsPerDay: number;
    differentiationGroups: string[];
  }): Promise<FillResult> {
    this.assertConfigured();
    const form = new FormData();
    form.append('template', bufToBlob(opts.template.buffer), opts.template.originalname);
    form.append('plan_json', JSON.stringify(opts.plan));
    form.append('period_minutes', String(opts.periodMinutes));
    form.append('segments_per_day', String(opts.segmentsPerDay));
    form.append('differentiation_groups', opts.differentiationGroups.join(','));
    const res = await fetch(`${this.baseUrl}/fill`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new InternalServerErrorException(`sidecar fill ${res.status}: ${detail}`);
    }
    const docx = Buffer.from(await res.arrayBuffer());
    let summary: unknown = null;
    try {
      summary = JSON.parse(res.headers.get('x-plan-json') ?? 'null');
    } catch {
      summary = null;
    }
    return {
      docx,
      structureLocked: res.headers.get('x-structure-locked') === 'true',
      pacingOk: res.headers.get('x-pacing-ok') === 'true',
      summary,
    };
  }
}
