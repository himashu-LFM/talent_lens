"""FastAPI entrypoint for TalentLens — AI Resume Screening & Ranking."""
from __future__ import annotations

import json
import logging
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from app import config
from app.export.excel import build_excel
from app.parsing import ocr
from app.scoring import embedding, skills
from app.services import (gmail_client, jd_analyzer, llm, mailer, public_intake,
                          retention, watcher)
from app.services.public_intake import IntakeError
from app.services.screening import match_against_roles, run_screening

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("talentlens")


@asynccontextmanager
async def lifespan(_: FastAPI):
    watcher.start()
    if config.supabase_configured():
        mailer.start()
        retention.start()
    else:
        log.info("Supabase not configured - email queue and retention workers idle")
    yield
    watcher.stop()
    mailer.stop()
    retention.stop()


app = FastAPI(title="TalentLens API", version="4.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS,
                   allow_methods=["*"], allow_headers=["*"])

# --------------------------------------------------------------------------
# Middleware: request id + timing, per-IP rate limit on heavy endpoints
# --------------------------------------------------------------------------
_hits: dict[str, deque] = defaultdict(deque)
_public_hits: dict[str, deque] = defaultdict(deque)
_RATE_PATHS = ("/api/screen", "/api/gmail/screen", "/api/match/roles")
_PUBLIC_PREFIX = "/api/public/"


@app.middleware("http")
async def observability(request: Request, call_next):
    rid = uuid.uuid4().hex[:8]
    start = time.perf_counter()
    ip = request.client.host if request.client else "unknown"
    if request.url.path in _RATE_PATHS:
        now = time.time()
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= config.RATE_LIMIT_PER_MINUTE:
            return JSONResponse({"detail": "Too many screening requests — please wait a minute."},
                                status_code=429)
        q.append(now)
    elif request.url.path.startswith(_PUBLIC_PREFIX) and request.method == "POST":
        now = time.time()
        q = _public_hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= config.PUBLIC_RATE_LIMIT_PER_HOUR:
            return JSONResponse(
                {"detail": "Too many submissions from this network. Please try again later."},
                status_code=429)
        q.append(now)
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001
        log.exception("[%s] unhandled error on %s", rid, request.url.path)
        return JSONResponse({"detail": "Internal server error."}, status_code=500)
    ms = (time.perf_counter() - start) * 1000
    log.info("[%s] %s %s -> %s (%.0f ms)", rid, request.method, request.url.path,
             response.status_code, ms)
    response.headers["X-Request-ID"] = rid
    return response


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": app.version}


@app.get("/api/ready")
def ready() -> dict:
    return {
        "status": "ok",
        "semantic_model": "ready" if embedding.available() else "unavailable",
        "gmail_configured": gmail_client.credentials_present(),
        "gmail_connected": gmail_client.is_connected(),
        "gmail_can_send": gmail_client.can_send() if gmail_client.is_connected() else False,
        "limits": {"max_files": config.MAX_FILES_PER_REQUEST, "max_file_mb": config.MAX_FILE_MB},
        "default_weights": config.DEFAULT_WEIGHTS,
        "watches": len(watcher.list_watches()),
        "unacked_auto_results": len(watcher.list_results(unacked_only=True)),
        "ocr": "ready" if ocr.available() else ocr.status(),
        "llm": {"available": llm.available(), "status": llm.status(),
                "model": config.LLM_MODEL, "max_candidates": config.LLM_MAX_CANDIDATES},
        "supabase": config.supabase_configured(),
        "public_apply": config.supabase_configured(),
        "app_url": config.PUBLIC_APP_URL,
    }


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _parse_weights(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        raise HTTPException(400, "weights must be a JSON object.")


def _validate_upload(f: UploadFile, data: bytes) -> None:
    name = (f.filename or "").lower()
    if not name.endswith(config.ALLOWED_EXTENSIONS):
        raise HTTPException(400, f"'{f.filename}': unsupported type. Allowed: "
                                 f"{', '.join(config.ALLOWED_EXTENSIONS)}")
    if len(data) > config.MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"'{f.filename}' exceeds the {config.MAX_FILE_MB} MB limit.")


# --------------------------------------------------------------------------
# Screening (upload)
# --------------------------------------------------------------------------
@app.post("/api/screen")
async def screen(
    title: str = Form(""),
    description: str = Form(...),
    top_n: int = Form(10),
    weights: str | None = Form(None),
    audit: bool = Form(False),
    deep: bool = Form(False),
    deep_top_n: int = Form(0),
    files: list[UploadFile] = File(...),
):
    if not files:
        raise HTTPException(400, "No resume files uploaded.")
    if len(files) > config.MAX_FILES_PER_REQUEST:
        raise HTTPException(400, f"Too many files ({len(files)}). Max {config.MAX_FILES_PER_REQUEST}.")
    if not description.strip():
        raise HTTPException(400, "Job description is required.")
    payload: list[tuple[str, bytes]] = []
    for f in files:
        data = await f.read()
        _validate_upload(f, data)
        payload.append((f.filename or "resume", data))
    return run_screening(title, description, top_n, payload,
                         weights=_parse_weights(weights),
                         audit=audit, deep=deep, deep_top_n=deep_top_n)


# --------------------------------------------------------------------------
# JD analyzer
# --------------------------------------------------------------------------
class JDRequest(BaseModel):
    title: str = ""
    description: str


@app.post("/api/jd/analyze")
def jd_analyze(req: JDRequest):
    if not req.description.strip():
        raise HTTPException(400, "Job description is required.")
    return jd_analyzer.analyze(req.title, req.description)


# --------------------------------------------------------------------------
# Custom skills taxonomy
# --------------------------------------------------------------------------
class SkillRequest(BaseModel):
    name: str
    aliases: list[str] = []


@app.get("/api/skills")
def skills_list():
    return {"builtin": skills.BUILTIN_SKILLS, "custom": skills.list_custom()}


@app.post("/api/skills/custom")
def skills_add(req: SkillRequest):
    try:
        return {"custom": skills.add_custom(req.name, req.aliases)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/skills/custom/{name}")
def skills_remove(name: str):
    return {"custom": skills.remove_custom(name)}


# --------------------------------------------------------------------------
# Gmail
# --------------------------------------------------------------------------
@app.get("/api/gmail/status")
def gmail_status() -> dict:
    connected = gmail_client.is_connected()
    return {"configured": gmail_client.credentials_present(), "connected": connected,
            "can_send": gmail_client.can_send() if connected else False}


@app.post("/api/gmail/connect")
def gmail_connect() -> dict:
    try:
        email = gmail_client.connect()
    except (gmail_client.GmailNotConfigured, gmail_client.GmailNotConnected) as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Gmail connection failed: {e}")
    return {"connected": True, "email": email, "can_send": gmail_client.can_send()}


@app.post("/api/gmail/disconnect")
def gmail_disconnect() -> dict:
    try:
        gmail_client.disconnect()
    except PermissionError as e:
        raise HTTPException(400, str(e))
    return {"connected": False}


@app.get("/api/gmail/labels")
def gmail_labels() -> dict:
    try:
        return {"labels": gmail_client.list_labels()}
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Could not list labels: {e}")


class CreateLabelRequest(BaseModel):
    name: str


@app.post("/api/gmail/labels/create")
def gmail_create_label(req: CreateLabelRequest):
    if not req.name.strip():
        raise HTTPException(400, "Label name is required.")
    try:
        return {"label": gmail_client.create_label(req.name)}
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Could not create label: {e}")


class GmailScreenRequest(BaseModel):
    title: str = ""
    description: str
    top_n: int = 10
    label_id: str
    unread_only: bool = True
    mark_read: bool = True
    weights: dict | None = None
    audit: bool = False
    deep: bool = False
    deep_top_n: int = 0


@app.post("/api/gmail/screen")
def gmail_screen(req: GmailScreenRequest):
    if not req.description.strip():
        raise HTTPException(400, "Job description is required.")
    try:
        files, meta = gmail_client.fetch_resumes(req.label_id, req.unread_only, req.mark_read)
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Fetching from Gmail failed: {e}")
    if not files:
        return {"job": {"title": req.title, "required_years": 0, "required_skills": [],
                        "extra_requirements": [], "weights": config.DEFAULT_WEIGHTS},
                "total_resumes": 0, "ranked": [], "top": [], "top_n": req.top_n,
                "errors": [], "flagged": [], "fetched": 0}
    result = run_screening(req.title, req.description, req.top_n, files,
                           sources=meta, weights=req.weights,
                           audit=req.audit, deep=req.deep, deep_top_n=req.deep_top_n)
    result["fetched"] = len(files)
    return result


class SendRequest(BaseModel):
    to: str
    subject: str
    body: str


@app.post("/api/gmail/send")
def gmail_send(req: SendRequest):
    if "@" not in req.to:
        raise HTTPException(400, "Valid recipient email required.")
    try:
        mid = gmail_client.send_email(req.to.strip(), req.subject.strip(), req.body)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Send failed: {e}")
    return {"sent": True, "id": mid}


# --------------------------------------------------------------------------
# Auto-screen watches
# --------------------------------------------------------------------------
class WatchRequest(BaseModel):
    label_id: str
    label_name: str = ""
    title: str = ""
    description: str
    top_n: int = 10
    interval_min: int = 15
    unread_only: bool = True
    mark_read: bool = True
    weights: dict | None = None
    audit: bool = False
    deep: bool = False
    deep_top_n: int = 0


class WatchUpdate(BaseModel):
    enabled: bool | None = None
    interval_min: int | None = None
    top_n: int | None = None
    unread_only: bool | None = None
    mark_read: bool | None = None


@app.get("/api/watches")
def watches_list():
    return {"watches": watcher.list_watches()}


@app.post("/api/watches")
def watches_add(req: WatchRequest):
    if not req.description.strip():
        raise HTTPException(400, "Job description is required.")
    return {"watch": watcher.add_watch(req.model_dump())}


@app.patch("/api/watches/{wid}")
def watches_update(wid: str, req: WatchUpdate):
    w = watcher.update_watch(wid, {k: v for k, v in req.model_dump().items() if v is not None})
    if not w:
        raise HTTPException(404, "Watch not found.")
    return {"watch": w}


@app.delete("/api/watches/{wid}")
def watches_delete(wid: str):
    watcher.delete_watch(wid)
    return {"deleted": True}


@app.post("/api/watches/{wid}/run")
def watches_run(wid: str):
    try:
        return watcher.run_watch_now(wid)
    except KeyError:
        raise HTTPException(404, "Watch not found.")
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Run failed: {e}")


@app.get("/api/watches/results")
def watches_results(unacked: bool = False):
    return {"results": watcher.list_results(unacked_only=unacked)}


@app.post("/api/watches/results/{rid}/ack")
def watches_ack(rid: str):
    watcher.ack_result(rid)
    return {"acked": True}


@app.delete("/api/watches/results/{rid}")
def watches_result_delete(rid: str):
    watcher.delete_result(rid)
    return {"deleted": True}


# --------------------------------------------------------------------------
# Excel export
# --------------------------------------------------------------------------
class Candidate(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""
    experience_years: float = 0
    score: float = 0
    matched_skills: list[str] = []
    missing_skills: list[str] = []
    status: str | None = None
    notes: str | None = None


class ExportRequest(BaseModel):
    candidates: list[Candidate]
    job_title: str = ""


@app.post("/api/export")
def export(req: ExportRequest):
    data = build_excel([c.model_dump() for c in req.candidates], req.job_title)
    safe = "".join(ch if ch.isalnum() else "_" for ch in (req.job_title or "candidates"))[:40]
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=shortlist_{safe}.xlsx"},
    )


# --------------------------------------------------------------------------
# Best-fit across open roles: one resume vs. several job descriptions
# --------------------------------------------------------------------------
@app.post("/api/match/roles")
async def match_roles(
    roles: str = Form(...),
    weights: str | None = Form(None),
    file: UploadFile = File(...),
):
    try:
        parsed_roles = json.loads(roles)
    except json.JSONDecodeError:
        raise HTTPException(400, "roles must be a JSON array.")
    if not isinstance(parsed_roles, list) or not parsed_roles:
        raise HTTPException(400, "Provide at least one role to compare against.")
    if len(parsed_roles) > 50:
        raise HTTPException(400, "Compare against at most 50 roles at a time.")
    for r in parsed_roles:
        if not isinstance(r, dict) or not (r.get("description") or "").strip():
            raise HTTPException(400, "Every role needs a description.")

    data = await file.read()
    _validate_upload(file, data)
    return match_against_roles(file.filename or "resume", data, parsed_roles,
                               weights=_parse_weights(weights))


# --------------------------------------------------------------------------
# Public, unauthenticated candidate flows
#
# Reachable only with an unguessable token. Every write goes through the
# service-role client, so no table carries an anonymous insert policy.
# --------------------------------------------------------------------------
def _intake_guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except IntakeError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("public intake error")
        raise HTTPException(500, "Something went wrong. Please try again.")


@app.get("/api/public/job/{token}")
def public_job(token: str) -> dict:
    return _intake_guard(public_intake.job_by_token, token)


@app.post("/api/public/apply/{token}")
async def public_apply(
    token: str,
    name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(""),
    location: str = Form(""),
    current_company: str = Form(""),
    current_title: str = Form(""),
    notice_period: str = Form(""),
    expected_salary: str = Form(""),
    cover_note: str = Form(""),
    links: str = Form(""),
    voluntary_demographics: str = Form(""),
    consent: bool = Form(False),
    resume: UploadFile = File(...),
):
    def _json_field(raw: str, label: str) -> dict:
        if not raw.strip():
            return {}
        try:
            val = json.loads(raw)
            return val if isinstance(val, dict) else {}
        except json.JSONDecodeError:
            raise HTTPException(400, f"{label} must be a JSON object.")

    data = await resume.read()
    form = {
        "name": name, "email": email, "phone": phone, "location": location,
        "current_company": current_company, "current_title": current_title,
        "notice_period": notice_period, "expected_salary": expected_salary,
        "cover_note": cover_note,
        "links": _json_field(links, "links"),
        "voluntary_demographics": _json_field(voluntary_demographics, "voluntary_demographics") or None,
        "consent": consent,
    }
    return _intake_guard(public_intake.submit_application, token, form,
                         resume.filename or "resume.pdf", data)


@app.get("/api/public/status/{status_token}")
def public_status(status_token: str) -> dict:
    return _intake_guard(public_intake.application_status, status_token)


class BookRequest(BaseModel):
    slot_id: str


@app.post("/api/public/status/{status_token}/book")
def public_book(status_token: str, req: BookRequest) -> dict:
    return _intake_guard(public_intake.book_slot, status_token, req.slot_id)


class DeletionRequest(BaseModel):
    reason: str = ""


@app.post("/api/public/status/{status_token}/delete-request")
def public_delete_request(status_token: str, req: DeletionRequest) -> dict:
    return _intake_guard(public_intake.request_deletion, status_token, req.reason)


# --------------------------------------------------------------------------
# Admin / background triggers
#
# These move or erase data, so they always require ADMIN_TOKEN — an unset token
# means "disabled", never "open". Useful for an external cron on a host where
# the in-process workers can't run continuously (e.g. a sleeping free tier).
# --------------------------------------------------------------------------
def _require_admin(request: Request) -> None:
    if not config.ADMIN_TOKEN:
        raise HTTPException(503, "Set ADMIN_TOKEN on the server to enable this endpoint.")
    if request.headers.get("X-Admin-Token") != config.ADMIN_TOKEN:
        raise HTTPException(401, "Invalid admin token.")


@app.post("/api/admin/mail/drain")
def admin_mail_drain(request: Request) -> dict:
    _require_admin(request)
    return mailer.drain_once()


@app.post("/api/admin/retention/run")
def admin_retention_run(request: Request) -> dict:
    _require_admin(request)
    return retention.run_all()


class EraseRequest(BaseModel):
    org_id: str
    email: str


@app.post("/api/admin/erase")
def admin_erase(request: Request, req: EraseRequest) -> dict:
    _require_admin(request)
    return retention.erase_candidate(req.org_id, req.email)
