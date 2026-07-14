"""FastAPI entrypoint for the AI Resume Screening & Ranking tool."""
from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.export.excel import build_excel
from app.services import gmail_client
from app.services.screening import run_screening

app = FastAPI(title="AI Resume Screener", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# --------------------------------------------------------------------------
# Upload-based screening
# --------------------------------------------------------------------------
@app.post("/api/screen")
async def screen(
    title: str = Form(...),
    description: str = Form(...),
    top_n: int = Form(10),
    files: list[UploadFile] = File(...),
):
    if not files:
        raise HTTPException(400, "No resume files uploaded.")
    if not description.strip():
        raise HTTPException(400, "Job description is required.")

    payload = [(f.filename, await f.read()) for f in files]
    return run_screening(title, description, top_n, payload)


# --------------------------------------------------------------------------
# Gmail-based screening
# --------------------------------------------------------------------------
@app.get("/api/gmail/status")
def gmail_status() -> dict:
    return {
        "configured": gmail_client.credentials_present(),
        "connected": gmail_client.is_connected(),
    }


@app.post("/api/gmail/connect")
def gmail_connect() -> dict:
    try:
        email = gmail_client.connect()
    except gmail_client.GmailNotConfigured as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Gmail connection failed: {e}")
    return {"connected": True, "email": email}


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
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Label name is required.")
    try:
        label = gmail_client.create_label(name)
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Could not create label: {e}")
    return {"label": label}


class GmailScreenRequest(BaseModel):
    title: str = ""
    description: str
    top_n: int = 10
    label_id: str
    unread_only: bool = True
    mark_read: bool = True


@app.post("/api/gmail/screen")
def gmail_screen(req: GmailScreenRequest):
    if not req.description.strip():
        raise HTTPException(400, "Job description is required.")
    try:
        files, meta = gmail_client.fetch_resumes(
            req.label_id, req.unread_only, req.mark_read
        )
    except gmail_client.GmailNotConnected as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Fetching from Gmail failed: {e}")

    if not files:
        return {
            "job": {"title": req.title, "required_years": 0, "required_skills": []},
            "total_resumes": 0, "ranked": [], "top": [], "top_n": req.top_n,
            "errors": [], "fetched": 0,
        }

    result = run_screening(req.title, req.description, req.top_n, files, sources=meta)
    result["fetched"] = len(files)
    return result


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


class ExportRequest(BaseModel):
    candidates: list[Candidate]


@app.post("/api/export")
def export(req: ExportRequest):
    data = build_excel([c.model_dump() for c in req.candidates])
    headers = {"Content-Disposition": "attachment; filename=top_candidates.xlsx"}
    return StreamingResponse(
        iter([data]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
