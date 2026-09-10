"""Outbound candidate email: merge-field rendering, calendar invites, and a
background worker that drains the `email_queue` table.

Queueing rather than sending inline means bulk sends and scheduled sends are the
same code path, a transient Gmail error retries instead of losing the message,
and the UI never blocks on SMTP.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from app.config import (MAILER_TICK_SECONDS, PUBLIC_APP_URL, supabase_configured)
from app.services import gmail_client, supabase_admin as sb

log = logging.getLogger("talentlens.mailer")

MAX_ATTEMPTS = 4
BATCH = 25

_thread: threading.Thread | None = None
_stop = threading.Event()

# Fallbacks used when an org hasn't written its own template yet.
DEFAULT_TEMPLATES: dict[str, dict[str, str]] = {
    "ack": {
        "name": "Application received",
        "subject": "We received your application — {{job_title}}",
        "body": ("Hi {{first_name}},\n\n"
                 "Thanks for applying for {{job_title}} at {{company}}. Your application "
                 "is in and we're reviewing it.\n\n"
                 "You can check your status any time here:\n{{status_link}}\n\n"
                 "Best regards\n{{company}} hiring team"),
    },
    "shortlisted": {
        "name": "Shortlisted",
        "subject": "Your application for {{job_title}}",
        "body": ("Hi {{first_name}},\n\n"
                 "Good news — we've shortlisted you for {{job_title}} and would like to "
                 "take the conversation further.\n\n"
                 "You can pick an interview slot here:\n{{status_link}}\n\n"
                 "Best regards\n{{company}} hiring team"),
    },
    "interview": {
        "name": "Interview confirmed",
        "subject": "Interview confirmed — {{job_title}}",
        "body": ("Hi {{first_name}},\n\n"
                 "Your interview for {{job_title}} is confirmed for {{interview_time}}.\n"
                 "{{interview_link}}\n\n"
                 "The calendar invite is attached. If you need to reschedule, reply to "
                 "this email.\n\n"
                 "Best regards\n{{company}} hiring team"),
    },
    "rejected": {
        "name": "Not moving forward",
        "subject": "Update on your application — {{job_title}}",
        "body": ("Hi {{first_name}},\n\n"
                 "Thank you for the time you put into applying for {{job_title}}. After "
                 "careful review we've decided to move forward with other candidates.\n\n"
                 "We appreciate your interest and wish you the best in your search.\n\n"
                 "Best regards\n{{company}} hiring team"),
    },
    "hired": {
        "name": "Offer",
        "subject": "Great news about {{job_title}}",
        "body": ("Hi {{first_name}},\n\n"
                 "We'd like to offer you the {{job_title}} role. We'll follow up shortly "
                 "with the details.\n\n"
                 "Best regards\n{{company}} hiring team"),
    },
}

MERGE_FIELDS = ["name", "first_name", "email", "job_title", "company", "score",
                "status_link", "interview_time", "interview_link", "recruiter", "location"]

_FIELD_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def render(template: str, ctx: dict) -> str:
    """Replace {{field}} with values from ctx. Unknown fields become empty
    strings so a candidate never receives a literal '{{first_name}}'."""
    def sub(m: re.Match) -> str:
        return str(ctx.get(m.group(1), "") or "")
    return _FIELD_RE.sub(sub, template or "")


def context_for(candidate: dict, job_title: str = "", company: str = "",
                status_token: str = "", recruiter: str = "",
                interview: dict | None = None) -> dict:
    name = (candidate.get("name") or "").strip()
    ctx = {
        "name": name or "there",
        "first_name": (name.split()[0] if name else "there"),
        "email": candidate.get("email", ""),
        "job_title": job_title or "the role",
        "company": company or "our team",
        "score": candidate.get("score", ""),
        "location": candidate.get("location", ""),
        "recruiter": recruiter,
        "status_link": f"{PUBLIC_APP_URL}/status/{status_token}" if status_token else "",
        "interview_time": "",
        "interview_link": "",
    }
    if interview:
        starts = interview.get("starts_at")
        if starts:
            ctx["interview_time"] = format_when(starts, interview.get("duration_min", 45))
        link = interview.get("meeting_link") or interview.get("location") or ""
        ctx["interview_link"] = f"Where: {link}" if link else ""
    return ctx


def format_when(iso: str, duration_min: int = 45) -> str:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return str(iso)
    end = dt + timedelta(minutes=duration_min)
    return f"{dt:%a %d %b %Y, %H:%M}–{end:%H:%M} UTC"


# ------------------------------------------------------------------ calendar
def build_ics(*, uid: str, summary: str, starts_at: str, duration_min: int = 45,
              description: str = "", location: str = "",
              organiser_email: str = "", attendee_email: str = "") -> str:
    """A minimal but valid VEVENT. Gmail and Outlook both render this as an invite."""
    def stamp(dt: datetime) -> str:
        return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    try:
        start = datetime.fromisoformat(str(starts_at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        start = datetime.now(timezone.utc)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    end = start + timedelta(minutes=max(5, int(duration_min or 45)))

    def esc(s: str) -> str:
        return (str(s or "").replace("\\", "\\\\").replace(";", r"\;")
                .replace(",", r"\,").replace("\n", r"\n"))

    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TalentLens//Interview//EN",
        "CALSCALE:GREGORIAN", "METHOD:REQUEST", "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{stamp(datetime.now(timezone.utc))}",
        f"DTSTART:{stamp(start)}", f"DTEND:{stamp(end)}",
        f"SUMMARY:{esc(summary)}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{esc(description)}")
    if location:
        lines.append(f"LOCATION:{esc(location)}")
    if organiser_email:
        lines.append(f"ORGANIZER;CN=Hiring team:mailto:{organiser_email}")
    if attendee_email:
        lines.append(
            "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;"
            f"RSVP=TRUE:mailto:{attendee_email}"
        )
    lines += ["STATUS:CONFIRMED", "SEQUENCE:0", "END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(lines)


# --------------------------------------------------------------------- queue
def enqueue(org_id: str, to_email: str, subject: str, body: str, *,
            to_name: str = "", send_after: str | None = None,
            run_id: str | None = None, candidate_key: str | None = None,
            application_id: str | None = None, interview_id: str | None = None,
            ics: str | None = None, created_by: str | None = None) -> dict | None:
    """Queue one message. Returns the row, or None when Supabase isn't configured."""
    if not supabase_configured():
        log.info("email not queued (Supabase not configured): %s", subject)
        return None
    row = {
        "org_id": org_id, "to_email": to_email, "to_name": to_name or None,
        "subject": subject, "body": body,
        "send_after": send_after or datetime.now(timezone.utc).isoformat(),
        "run_id": run_id, "candidate_key": candidate_key,
        "application_id": application_id, "interview_id": interview_id,
        "ics": ics, "created_by": created_by,
    }
    out = sb.insert("email_queue", row)
    return out[0] if out else None


def template_for(org_id: str, stage: str) -> dict:
    """The org's template for a stage, falling back to the built-in default."""
    fallback = DEFAULT_TEMPLATES.get(stage) or DEFAULT_TEMPLATES["ack"]
    if not supabase_configured():
        return dict(fallback)
    try:
        rows = sb.select("email_templates", {
            "org_id": f"eq.{org_id}", "stage": f"eq.{stage}",
            "order": "is_default.desc,updated_at.desc", "limit": "1",
        })
        if rows:
            return {"name": rows[0]["name"], "subject": rows[0]["subject"],
                    "body": rows[0]["body"]}
    except Exception as e:  # noqa: BLE001
        log.info("template lookup failed for %s/%s: %s", org_id, stage, e)
    return dict(fallback)


def _send_row(row: dict) -> None:
    ics = row.get("ics")
    attachments = None
    if ics:
        attachments = [("invite.ics", ics.encode("utf-8"),
                        "text/calendar; method=REQUEST; charset=UTF-8")]
    msg_id = gmail_client.send_email(
        row["to_email"], row["subject"], row["body"], attachments=attachments
    )
    sb.update("email_queue", {"id": f"eq.{row['id']}"}, {
        "status": "sent",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "message_id": msg_id,
        "attempts": int(row.get("attempts", 0)) + 1,
        "last_error": None,
    })


def drain_once(limit: int = BATCH) -> dict:
    """Send every due queued message. Returns a small summary."""
    if not supabase_configured():
        return {"ran": False, "reason": "supabase not configured"}
    if not gmail_client.can_send():
        return {"ran": False, "reason": "gmail send permission not granted"}

    now = datetime.now(timezone.utc).isoformat()
    try:
        rows = sb.select("email_queue", {
            "status": "eq.queued", "send_after": f"lte.{now}",
            "order": "send_after.asc", "limit": str(limit),
        })
    except Exception as e:  # noqa: BLE001
        log.warning("could not read email queue: %s", e)
        return {"ran": False, "reason": str(e)[:200]}

    sent = failed = 0
    for row in rows:
        try:
            _send_row(row)
            sent += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            attempts = int(row.get("attempts", 0)) + 1
            patch = {"attempts": attempts, "last_error": str(e)[:400]}
            if attempts >= MAX_ATTEMPTS:
                patch["status"] = "failed"
            else:
                # exponential-ish backoff: 2, 8, 18 minutes
                delay = 2 * (attempts ** 2)
                patch["send_after"] = (
                    datetime.now(timezone.utc) + timedelta(minutes=delay)
                ).isoformat()
            try:
                sb.update("email_queue", {"id": f"eq.{row['id']}"}, patch)
            except Exception:  # noqa: BLE001
                pass
            log.warning("email %s failed (attempt %s): %s", row["id"], attempts, e)
    return {"ran": True, "sent": sent, "failed": failed, "considered": len(rows)}


def _loop() -> None:
    log.info("email queue worker started (tick %ss)", MAILER_TICK_SECONDS)
    while not _stop.is_set():
        try:
            out = drain_once()
            if out.get("sent") or out.get("failed"):
                log.info("email queue: %s", out)
        except Exception as e:  # noqa: BLE001
            log.warning("mailer tick error: %s", e)
        _stop.wait(MAILER_TICK_SECONDS)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="mailer", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
