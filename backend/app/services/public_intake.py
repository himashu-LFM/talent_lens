"""Candidate-facing flows: the public application form and the status page.

These are the only unauthenticated write paths in the product, so they are kept
deliberately narrow:

  • a job is only reachable by its unguessable `public_token`, and only while
    `apply_enabled` and `is_open` are true
  • an application is only readable by its unguessable `status_token`, and the
    response contains that candidate's own data and nothing else — never the
    score, never other applicants, never internal notes
  • all writes go through the service-role client, so there is no anonymous
    insert policy on any table
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from datetime import datetime, timezone

from app.config import PUBLIC_APP_URL, supabase_configured
from app.services import mailer, supabase_admin as sb
from app.services.screening import run_screening

log = logging.getLogger("talentlens.intake")

ALLOWED_RESUME_EXTS = (".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".webp")
MAX_RESUME_MB = 15
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# What the candidate is told, per internal stage. Deliberately kinder and
# vaguer than the internal label — "rejected" is not something to read on a page.
STAGE_PUBLIC = {
    "new": ("received", "Application received", "We have your application and it's in the queue."),
    "shortlisted": ("in_review", "Under review", "Your application is being reviewed by the hiring team."),
    "interview": ("interview", "Interview stage", "The team would like to speak with you."),
    "hired": ("offer", "Offer stage", "Great news — the team will be in touch with next steps."),
    "rejected": ("closed", "Not moving forward", "After careful review the team decided to progress other candidates for this role."),
}


class IntakeError(Exception):
    """A message safe to show an anonymous candidate."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_supabase() -> None:
    if not supabase_configured():
        raise IntakeError("Applications are not accepting submissions right now.")


# ------------------------------------------------------------------ the job
def job_by_token(token: str) -> dict:
    """Public view of an applyable job. Raises IntakeError when unavailable."""
    _require_supabase()
    rows = sb.select("jobs", {
        "public_token": f"eq.{token}",
        "select": "id,org_id,title,description,location,employment_type,is_open,apply_enabled",
    })
    job = rows[0] if rows else None
    if not job:
        raise IntakeError("This job link is not valid.")
    if not job.get("apply_enabled"):
        raise IntakeError("This role is not accepting applications through this link.")
    if not job.get("is_open"):
        raise IntakeError("This role is closed. Thank you for your interest.")

    org = sb.select("organizations", {"id": f"eq.{job['org_id']}",
                                      "select": "name,contact_email"}, single=True) or {}
    return {
        "title": job["title"],
        "description": job["description"],
        "location": job.get("location") or "",
        "employment_type": job.get("employment_type") or "",
        "company": org.get("name") or "",
        "contact_email": org.get("contact_email") or "",
    }


def _job_row(token: str) -> dict:
    _require_supabase()
    rows = sb.select("jobs", {"public_token": f"eq.{token}", "select": "*"})
    job = rows[0] if rows else None
    if not job:
        raise IntakeError("This job link is not valid.")
    if not job.get("apply_enabled") or not job.get("is_open"):
        raise IntakeError("This role is not accepting applications.")
    return job


# ---------------------------------------------------------------- apply
def submit_application(token: str, form: dict, filename: str, data: bytes) -> dict:
    """Store, parse and pre-score one application. Returns the status link."""
    job = _job_row(token)
    org_id = job["org_id"]

    name = (form.get("name") or "").strip()
    email = (form.get("email") or "").strip().lower()
    if len(name) < 2:
        raise IntakeError("Please enter your full name.")
    if not EMAIL_RE.match(email):
        raise IntakeError("Please enter a valid email address.")
    if not form.get("consent"):
        raise IntakeError("We need your consent to process your application.")
    if not data:
        raise IntakeError("Please attach your resume.")
    if len(data) > MAX_RESUME_MB * 1024 * 1024:
        raise IntakeError(f"Your resume is larger than {MAX_RESUME_MB} MB.")
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED_RESUME_EXTS:
        raise IntakeError("Please upload a PDF, DOCX, TXT or a clear photo of your resume.")

    # One application per person per role.
    existing = sb.select("applications", {
        "job_id": f"eq.{job['id']}", "email": f"ilike.{email}",
        "select": "id,status_token", "limit": "1",
    })
    if existing:
        return {
            "duplicate": True,
            "status_token": existing[0]["status_token"],
            "status_url": f"{PUBLIC_APP_URL}/status/{existing[0]['status_token']}",
            "message": "You have already applied for this role. Here is your status link.",
        }

    # Screen immediately so the recruiter sees a ranked application, not a blob.
    parsed_payload: dict = {}
    score = breakdown = matched = missing = None
    try:
        result = run_screening(job["title"], job["description"], 1,
                               [(filename, data)], sources={filename: "application form"},
                               weights=job.get("weights"))
        if result["ranked"]:
            top = result["ranked"][0]
            parsed_payload = {
                "skills": top.get("skills", []),
                "experience_years": top.get("experience_years", 0),
                "profile": top.get("profile", {}),
                "confidence": top.get("confidence"),
                "brief": top.get("brief", {}),
                "parsed_name": top.get("name", ""),
                "parsed_location": top.get("location", ""),
                "links": top.get("links", {}),
            }
            score = top.get("score")
            breakdown = top.get("breakdown")
            matched = top.get("matched_skills")
            missing = top.get("missing_skills")
        elif result["flagged"]:
            raise IntakeError(
                "We couldn't read that file as a resume. Please upload a PDF or DOCX "
                "of your CV, or a clear photo of it."
            )
        elif result["errors"]:
            raise IntakeError(
                f"We couldn't read that file: {result['errors'][0].get('error', 'unknown error')}"
            )
    except IntakeError:
        raise
    except Exception as e:  # noqa: BLE001 — never lose an application to a parse bug
        log.warning("intake screening failed for %s: %s", email, e)

    # Store the original document (deduped per org by content hash).
    resume_id = None
    try:
        sha1 = hashlib.sha1(data).hexdigest()
        path = f"{org_id}/{sha1}{ext}"
        sb.storage_upload(path, data, _content_type(ext))
        rows = sb.insert("resume_files", {
            "org_id": org_id, "sha1": sha1, "filename": filename,
            "storage_path": path, "size_bytes": len(data), "content_type": _content_type(ext),
        }, upsert=True, on_conflict="org_id,sha1")
        if rows:
            resume_id = rows[0]["id"]
    except Exception as e:  # noqa: BLE001
        log.warning("intake resume upload failed for %s: %s", email, e)

    row = {
        "org_id": org_id, "job_id": job["id"],
        "name": name, "email": email,
        "phone": (form.get("phone") or "").strip() or None,
        "location": (form.get("location") or "").strip() or None,
        "notice_period": (form.get("notice_period") or "").strip() or None,
        "expected_salary": (form.get("expected_salary") or "").strip() or None,
        "current_company": (form.get("current_company") or "").strip() or None,
        "current_title": (form.get("current_title") or "").strip() or None,
        "links": form.get("links") or {},
        "cover_note": (form.get("cover_note") or "").strip()[:4000] or None,
        "voluntary_demographics": form.get("voluntary_demographics") or None,
        "consent": True, "consent_at": _now(),
        "resume_id": resume_id,
        "parsed": parsed_payload or None,
        "score": score, "breakdown": breakdown,
        "matched_skills": matched, "missing_skills": missing,
        "screened_at": _now() if score is not None else None,
    }
    created = sb.insert("applications", row)
    app = created[0] if created else {}
    status_token = app.get("status_token", "")

    if job.get("auto_ack"):
        _queue_ack(org_id, job, app)

    return {
        "duplicate": False,
        "status_token": status_token,
        "status_url": f"{PUBLIC_APP_URL}/status/{status_token}" if status_token else "",
        "message": "Application received.",
    }


def _content_type(ext: str) -> str:
    return {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".txt": "text/plain",
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "application/octet-stream")


def _queue_ack(org_id: str, job: dict, app: dict) -> None:
    try:
        org = sb.select("organizations", {"id": f"eq.{org_id}", "select": "name"},
                        single=True) or {}
        tpl = mailer.template_for(org_id, "ack")
        ctx = mailer.context_for(
            {"name": app.get("name", ""), "email": app.get("email", "")},
            job_title=job.get("title", ""), company=org.get("name", ""),
            status_token=app.get("status_token", ""),
        )
        mailer.enqueue(
            org_id, app["email"],
            mailer.render(tpl["subject"], ctx), mailer.render(tpl["body"], ctx),
            to_name=app.get("name", ""), application_id=app.get("id"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning("ack email not queued for %s: %s", app.get("email"), e)


# ---------------------------------------------------------------- status page
def _app_by_token(status_token: str) -> dict:
    _require_supabase()
    rows = sb.select("applications", {"status_token": f"eq.{status_token}", "select": "*"})
    if not rows:
        raise IntakeError("This status link is not valid.")
    return rows[0]


def application_status(status_token: str) -> dict:
    """The candidate's own view. Deliberately excludes the score and any
    internal assessment — those are for the hiring team, not the applicant."""
    app = _app_by_token(status_token)
    job = sb.select("jobs", {"id": f"eq.{app['job_id']}",
                             "select": "id,title,location,is_open"}, single=True) or {}
    org = sb.select("organizations", {"id": f"eq.{app['org_id']}",
                                      "select": "name,contact_email"}, single=True) or {}

    code, label, blurb = STAGE_PUBLIC.get(app.get("status", "new"), STAGE_PUBLIC["new"])

    booked = sb.select("interviews", {
        "application_id": f"eq.{app['id']}", "status": "eq.scheduled",
        "order": "starts_at.asc", "limit": "1",
        "select": "id,starts_at,duration_min,mode,location,meeting_link",
    })
    interview = booked[0] if booked else None

    slots: list[dict] = []
    if code == "interview" and not interview:
        rows = sb.select("interview_slots", {
            "job_id": f"eq.{app['job_id']}", "taken_by": "is.null",
            "starts_at": f"gte.{_now()}", "order": "starts_at.asc", "limit": "12",
            "select": "id,starts_at,duration_min,mode,location",
        })
        slots = rows or []

    return {
        "candidate_name": app.get("name", ""),
        "job_title": job.get("title", ""),
        "job_location": job.get("location") or "",
        "company": org.get("name") or "",
        "contact_email": org.get("contact_email") or "",
        "submitted_at": app.get("created_at"),
        "stage": code,
        "stage_label": label,
        "stage_blurb": blurb,
        "interview": interview,
        "slots": slots,
        "can_book": bool(slots),
    }


def book_slot(status_token: str, slot_id: str) -> dict:
    """Candidate self-books an offered interview slot."""
    app = _app_by_token(status_token)
    if app.get("status") != "interview":
        raise IntakeError("There are no interview slots to book for you right now.")

    slot = sb.select("interview_slots", {"id": f"eq.{slot_id}", "select": "*"}, single=True)
    if not slot or slot.get("job_id") != app["job_id"]:
        raise IntakeError("That slot is not available.")
    if slot.get("taken_by"):
        raise IntakeError("Sorry, that slot was just taken. Please pick another.")

    # Claim the slot conditionally: `taken_by=is.null` makes this a no-op if
    # another candidate won the race, so two people can't book the same slot.
    claimed = sb.update("interview_slots",
                        {"id": f"eq.{slot_id}", "taken_by": "is.null"},
                        {"taken_by": app["id"], "taken_at": _now()})
    if not claimed:
        raise IntakeError("Sorry, that slot was just taken. Please pick another.")

    job = sb.select("jobs", {"id": f"eq.{app['job_id']}", "select": "id,title"},
                    single=True) or {}
    org = sb.select("organizations", {"id": f"eq.{app['org_id']}",
                                      "select": "name,contact_email"}, single=True) or {}

    created = sb.insert("interviews", {
        "org_id": app["org_id"], "job_id": app["job_id"], "application_id": app["id"],
        "candidate_name": app.get("name"), "candidate_email": app.get("email"),
        "starts_at": slot["starts_at"], "duration_min": slot.get("duration_min", 45),
        "mode": slot.get("mode", "video"), "location": slot.get("location"),
        "meeting_link": slot.get("meeting_link"),
        "interviewer_ids": [slot["interviewer_id"]] if slot.get("interviewer_id") else [],
    })
    interview = created[0] if created else {}

    try:
        tpl = mailer.template_for(app["org_id"], "interview")
        ctx = mailer.context_for(
            {"name": app.get("name", ""), "email": app.get("email", "")},
            job_title=job.get("title", ""), company=org.get("name", ""),
            status_token=status_token, interview=interview,
        )
        ics = mailer.build_ics(
            uid=interview.get("ics_uid") or interview.get("id", "talentlens"),
            summary=f"Interview — {job.get('title', 'role')} at {org.get('name', '')}".strip(),
            starts_at=interview.get("starts_at", slot["starts_at"]),
            duration_min=interview.get("duration_min", 45),
            description=f"Interview for {job.get('title', 'the role')}.",
            location=interview.get("meeting_link") or interview.get("location") or "",
            organiser_email=org.get("contact_email") or "",
            attendee_email=app.get("email") or "",
        )
        mailer.enqueue(app["org_id"], app["email"],
                       mailer.render(tpl["subject"], ctx), mailer.render(tpl["body"], ctx),
                       to_name=app.get("name", ""), application_id=app["id"],
                       interview_id=interview.get("id"), ics=ics)
    except Exception as e:  # noqa: BLE001
        log.warning("interview confirmation not queued: %s", e)

    return {
        "booked": True,
        "starts_at": interview.get("starts_at", slot["starts_at"]),
        "when": mailer.format_when(interview.get("starts_at", slot["starts_at"]),
                                   interview.get("duration_min", 45)),
        "mode": interview.get("mode", "video"),
        "message": "Your interview is confirmed. A calendar invite is on its way.",
    }


def request_deletion(status_token: str, reason: str = "") -> dict:
    """Candidate exercises their right to erasure."""
    app = _app_by_token(status_token)
    existing = sb.select("deletion_requests", {
        "org_id": f"eq.{app['org_id']}", "email": f"ilike.{app['email']}",
        "status": "eq.pending", "select": "id", "limit": "1",
    })
    if not existing:
        sb.insert("deletion_requests", {
            "org_id": app["org_id"], "email": app["email"],
            "reason": (reason or "")[:500] or None, "source": "candidate",
        })
    return {
        "received": True,
        "message": ("Your deletion request has been recorded. Your personal data will be "
                    "erased from this hiring process, and we'll keep only an anonymous "
                    "record that an application was reviewed."),
    }
