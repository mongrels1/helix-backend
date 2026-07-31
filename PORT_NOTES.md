# Lesson Plan Maker — EdKairos port (backend cut)

This adds the **Lesson Plan Maker** to EdKairos as a NestJS module plus a small
Python **docx sidecar**. All LLM generation goes through the existing
`AIRouterService` (Claude); the sidecar is deterministic and does the docx work
that is safest in Python (parse / extract / structure-locked fill).

## Design

```
teacher UI ──► helix-backend  intelligence/lesson-plan
                 │  createJob, uploadTemplate, uploadResources, generate, download
                 │
                 ├──► AIRouterService.chat({preferredProvider:'claude'})  ← drafts plan CONTENT (no minutes)
                 └──► lesson-plan-svc (Python)                            ← parse / extract / time-weight + fill
                                                                            returns the filled .docx, structure-locked
```

Why a sidecar: the structure-lock guarantee ("the template can never be
altered") is already proven in Python (`docx_template.py` asserts
`structural_signature(output) == structural_signature(template)` and refuses to
return a drifted doc). Re-deriving that in Node is risk with no upside.

## Files added

**helix-backend/src/intelligence/lesson-plan/**
- `lesson-plan.controller.ts` — `@Controller('api/v1/lesson-plan')`, `@Roles(TEACHER, ORG_ADMIN, SUPER_ADMIN)`
- `lesson-plan.service.ts` — orchestration (Claude draft → sidecar fill); v1 in-memory job store
- `lesson-plan.sidecar.ts` — HTTP client for lesson-plan-svc (shared-secret header)
- `lesson-plan.prompt.ts` — system prompt + prompt builder + JSON extractor (TS port)
- `lesson-plan.module.ts`
- `dto/generate-plan.dto.ts`

**lesson-plan-svc/** (new top-level folder, deploy as its own Railway service)
- `app.py` (FastAPI: /parse-template, /extract, /fill, /health)
- `docx_template.py` (structure-locked parse + fill + signature check)
- `extractors.py` (docx/pdf/xlsx/csv/pptx/txt/image/url → text + classify)
- `timeweight.py` (pacing: minutes sum to the period; phase selection)
- `Dockerfile`, `railway.json`, `requirements.txt`, `.env.example`, `README.md`

## Files edited (additive)

- `src/app.module.ts` — imports + registers `LessonPlanModule`
- `src/config/configuration.ts` — adds a `lessonPlan` config block

## Endpoints

```
POST /api/v1/lesson-plan/jobs                     -> { jobId }
POST /api/v1/lesson-plan/jobs/:id/template        (multipart 'file')  -> { fieldMap }
POST /api/v1/lesson-plan/jobs/:id/resources       (multipart 'files') -> { resources[] }
POST /api/v1/lesson-plan/jobs/:id/generate        (GeneratePlanDto)   -> { engine, structureLocked, pacingOk, summary, download }
GET  /api/v1/lesson-plan/jobs/:id/plan.docx       -> filled .docx
```

`GeneratePlanDto`: `periodMinutes` (required — "How long is the period?"),
`days[]`, `segmentsPerDay`, `differentiationGroups[]` (subset of ESOL/Gifted/SWD),
`strategies[]?`, `grade?`, `unit?`, `week?`, `teacher?`, `coTeaching?`.

## Environment

helix-backend:
```
LESSON_PLAN_SVC_URL=http://lesson-plan-svc.railway.internal:8000   # sidecar internal URL
LESSON_PLAN_SVC_SECRET=<long-random-string>                        # must equal sidecar SIDECAR_SECRET
LESSON_PLAN_CLAUDE_MODEL=                                          # optional: a Sonnet/Opus id for higher quality
```
lesson-plan-svc:
```
SIDECAR_SECRET=<same long-random-string>
```

`ANTHROPIC_API_KEY` is already configured for the AI router — generation reuses it.

## Deploy the sidecar (Railway)

1. New service from `lesson-plan-svc/` (Dockerfile build; `railway.json` sets the start command + `/health` check).
2. Set `SIDECAR_SECRET`.
3. Give helix-backend `LESSON_PLAN_SVC_URL` (the sidecar's internal URL) and the same secret as `LESSON_PLAN_SVC_SECRET`.

## Build / verify

```
cd helix-backend && npm run build      # native tsc gate (the deploy gate per handoff)
```
The new files parse clean and follow existing module conventions. No Prisma
migration is required for v1 (job state is in-memory).

## Frontend wiring (next step — not in this cut)

Add `helix-frontend/src/pages/teacher/LessonPlanMakerPage.tsx` (the approved
five-step flow; the standalone `frontend/index.html` is the reference), then:
- register a route in `App.tsx` under the teacher/protected routes, e.g.
  `<Route path="lesson-plan" element={<LessonPlanMakerPage />} />`;
- add a "Lesson Plan Maker" item to the teacher nav/sidebar;
- call the endpoints above with the app's authenticated API client (JWT).

## Production hardening (after v1)

- **Persistence:** swap the in-memory `jobs` map for a Prisma model + R2 artifact
  storage. Suggested model:

  ```prisma
  model LessonPlanJob {
    id         String   @id @default(cuid())
    teacherId  String
    orgId      String?
    status     String   @default("draft")
    templateKey String?          // R2 object key for the uploaded template
    templateName String?
    fieldMap   Json?
    resources  Json?             // [{filename,type,detected,chars}] (+ text in object storage)
    plan       Json?
    docxKey    String?           // R2 object key for the generated .docx
    pacingOk   Boolean  @default(false)
    createdAt  DateTime @default(now())
    updatedAt  DateTime @updatedAt
    @@index([teacherId])
  }
  ```
  Store template + generated docx in R2 (add `putObject`/`getObject` to
  `R2StorageService`) instead of holding buffers in memory.
- **Limits:** cap resource count/size; the controller already caps at 25 files.
- **Async:** for large batches, move generation to the events/queue subsystem and
  poll job status.
