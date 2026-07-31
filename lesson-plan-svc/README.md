# lesson-plan-svc — EdKairos docx sidecar

Deterministic, stateless FastAPI service. No LLM, no database. helix-backend
(NestJS) calls it over HTTP with the shared `X-Sidecar-Secret` header.

Endpoints: `POST /parse-template`, `POST /extract`, `POST /fill`, `GET /health`.

The `/fill` endpoint applies time-weighting (minutes sum to the period), prunes
differentiation to the teacher's selected groups, fills the uploaded template
**structure-locked**, and refuses to return a document whose structural
signature changed.

## Run locally
    pip install -r requirements.txt
    SIDECAR_SECRET=dev uvicorn app:app --port 8000

## Deploy (Railway)
New service from this folder (Dockerfile build). Set `SIDECAR_SECRET`. Give
helix-backend `LESSON_PLAN_SVC_URL` (this service's internal URL) and the same
secret as `LESSON_PLAN_SVC_SECRET`.
