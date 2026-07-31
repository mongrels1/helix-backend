"""
lesson-plan-svc — EdKairos deterministic docx sidecar (FastAPI).

Pure, stateless, NO LLM. helix-backend (NestJS) owns auth, persistence, and the
Claude call (via AIRouterService); this service does the three things that are
easiest and safest in Python:

  POST /parse-template   (multipart: file)                 -> field map
  POST /extract          (multipart: files[])              -> normalized text + classification
  POST /fill             (multipart: template + plan_json) -> filled .docx (structure-locked)

All routes require the shared secret header  X-Sidecar-Secret == $SIDECAR_SECRET
so only helix-backend can reach it. Deploy as a separate Railway service.
"""
from __future__ import annotations
import os, json, tempfile
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse

import extractors, docx_template, timeweight

app = FastAPI(title="EdKairos lesson-plan-svc", version="1.0")
SECRET = os.environ.get("SIDECAR_SECRET", "")

def _auth(x_sidecar_secret: str | None):
    if not SECRET or x_sidecar_secret != SECRET:
        raise HTTPException(401, "bad or missing sidecar secret")

def _save(upload: UploadFile) -> str:
    suffix = os.path.splitext(upload.filename or "")[1] or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(upload.file.read())
    return path

@app.get("/health")
def health():
    return {"ok": True, "service": "lesson-plan-svc", "secret_set": bool(SECRET)}

@app.post("/parse-template")
async def parse_template(file: UploadFile = File(...),
                         x_sidecar_secret: str | None = Header(default=None)):
    _auth(x_sidecar_secret)
    path = _save(file)
    try:
        info = docx_template.parse_template(path)
    except Exception as e:
        raise HTTPException(400, f"could not parse template: {e}")
    finally:
        os.unlink(path)
    return {"fieldMap": info}

@app.post("/extract")
async def extract(files: list[UploadFile] = File(...),
                  x_sidecar_secret: str | None = Header(default=None)):
    _auth(x_sidecar_secret)
    out = []
    for f in files:
        path = _save(f)
        try:
            text = extractors.extract_text(path, f.filename)
        finally:
            os.unlink(path)
        label = extractors.classify(text, f.filename)
        out.append({"filename": f.filename, "type": label,
                    "detected": extractors.summarize_detection(text, label),
                    "chars": len(text), "text": text})
    return {"resources": out}

@app.post("/fill")
async def fill(template: UploadFile = File(...),
               plan_json: str = Form(...),
               period_minutes: int = Form(...),
               segments_per_day: int = Form(3),
               differentiation_groups: str = Form("ESOL,Gifted,SWD"),
               x_sidecar_secret: str | None = Header(default=None)):
    """template = the teacher's .docx; plan_json = LLM-drafted content (no minutes).
    Applies deterministic time-weighting, prunes differentiation to the selected
    groups, fills the template structure-locked, and returns the .docx."""
    _auth(x_sidecar_secret)
    try:
        plan = json.loads(plan_json)
    except Exception as e:
        raise HTTPException(422, f"plan_json not valid JSON: {e}")
    groups = [g.strip() for g in differentiation_groups.split(",") if g.strip()]
    plan = timeweight.apply_pacing(plan, period_minutes, segments_per_day, groups)

    in_path = _save(template)
    out_path = in_path.replace(".docx", "_FILLED.docx")
    try:
        result = docx_template.fill_template(in_path, out_path, plan)
    except Exception as e:
        raise HTTPException(400, f"fill failed: {e}")
    finally:
        os.unlink(in_path)

    if not result.get("structure_locked"):
        # never return a doc whose structure drifted
        raise HTTPException(500, "structure-lock check failed; refusing to return altered document")
    headers = {
        "X-Structure-Locked": "true",
        "X-Pacing-Ok": str(plan.get("_pacing_ok", False)).lower(),
        "X-Plan-Json": json.dumps(_plan_summary(plan)),
    }
    return FileResponse(out_path, filename="lesson_plan_filled.docx",
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers=headers)

def _plan_summary(plan: dict) -> dict:
    """Compact preview (no full text) the backend can return to the UI."""
    return {"pacing_ok": plan.get("_pacing_ok"), "days": [
        {"name": d.get("name"),
         "standard": d.get("standard"),
         "learning_target": d.get("learning_target"),
         "segments": [{"lesson_component": s.get("lesson_component"),
                       "minutes": s.get("minutes"),
                       "differentiation": list((s.get("differentiation") or {}).keys())}
                      for s in d.get("segments", [])]}
        for d in plan.get("days", [])]}
