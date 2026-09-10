"""Data retention and candidate deletion requests (DPDP Act / GDPR).

Two jobs run on a slow timer:

  • **retention sweep** — for every org that set `retention_days`, candidate PII
    older than the window is erased: the stored resume is deleted from Storage,
    contact fields are nulled on applications, and the PII inside a saved run's
    `results` blob is redacted. Scores and aggregate counts survive, so History
    and Insights keep working with no personal data left behind.

  • **deletion requests** — a candidate asking to be forgotten is erased across
    applications, reviews and every run they appear in, then the request is
    marked completed with a timestamp for the audit trail.

Erasure is deliberately redaction-in-place rather than row deletion: it keeps
the hiring record defensible ("we screened 42 people for this role") while
removing the person.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta, timezone

from app.config import RETENTION_TICK_HOURS, supabase_configured
from app.services import supabase_admin as sb

log = logging.getLogger("talentlens.retention")

_thread: threading.Thread | None = None
_stop = threading.Event()

REDACTED = "[redacted]"
_PII_KEYS = ("name", "email", "phone", "location", "links", "best_match_snippet",
             "evidence", "brief", "interview_questions")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _redact_candidate(c: dict) -> dict:
    out = dict(c)
    out["name"] = REDACTED
    out["email"] = ""
    out["phone"] = ""
    out["location"] = ""
    out["links"] = {}
    # Free text quoted from the resume can carry identity; the numbers cannot.
    out["best_match_snippet"] = ""
    out["evidence"] = {}
    out["interview_questions"] = []
    if isinstance(out.get("brief"), dict):
        brief = dict(out["brief"])
        brief["headline"] = REDACTED
        out["brief"] = brief
    prof = out.get("profile")
    if isinstance(prof, dict):
        p = dict(prof)
        p["roles"] = [{k: v for k, v in r.items() if k in ("start", "end", "months", "current")}
                      for r in (p.get("roles") or [])]
        p["education"] = []
        p["current_company"] = ""
        out["profile"] = p
    return out


def _redact_results(results: dict, only_emails: set[str] | None = None) -> tuple[dict, int]:
    """Redact PII inside a run's stored results. When `only_emails` is given,
    redact just those candidates; otherwise redact everyone."""
    if not isinstance(results, dict):
        return results, 0
    out = dict(results)
    touched = 0
    for key in ("ranked", "top"):
        rows = out.get(key)
        if not isinstance(rows, list):
            continue
        new_rows = []
        for c in rows:
            if not isinstance(c, dict):
                new_rows.append(c)
                continue
            email = (c.get("email") or "").lower()
            if only_emails is None or (email and email in only_emails):
                new_rows.append(_redact_candidate(c))
                touched += 1
            else:
                new_rows.append(c)
        out[key] = new_rows
    flagged = out.get("flagged")
    if isinstance(flagged, list) and only_emails is None:
        out["flagged"] = [{**f, "name": REDACTED} if isinstance(f, dict) else f
                          for f in flagged]
    return out, touched


def _delete_resumes(resume_ids: list[str]) -> int:
    """Remove the stored files and their metadata rows."""
    resume_ids = [r for r in resume_ids if r]
    if not resume_ids:
        return 0
    ids = ",".join(resume_ids)
    try:
        rows = sb.select("resume_files", {"id": f"in.({ids})", "select": "id,storage_path"})
    except Exception as e:  # noqa: BLE001
        log.warning("could not look up resume files: %s", e)
        return 0
    paths = [r["storage_path"] for r in rows if r.get("storage_path")]
    if paths:
        try:
            sb.storage_delete(paths)
        except Exception as e:  # noqa: BLE001
            log.warning("storage delete failed: %s", e)
    try:
        sb.delete("resume_files", {"id": f"in.({ids})"})
    except Exception as e:  # noqa: BLE001
        log.warning("resume_files delete failed: %s", e)
    return len(rows)


# ------------------------------------------------------------------- sweep
def sweep() -> dict:
    """Purge data past every org's retention window."""
    if not supabase_configured():
        return {"ran": False, "reason": "supabase not configured"}
    try:
        orgs = sb.select("organizations", {"retention_days": "gt.0",
                                           "select": "id,name,retention_days"})
    except Exception as e:  # noqa: BLE001
        return {"ran": False, "reason": str(e)[:200]}

    summary = {"ran": True, "orgs": 0, "applications": 0, "runs": 0, "resumes": 0}
    for org in orgs:
        cutoff = (_now() - timedelta(days=int(org["retention_days"]))).isoformat()
        summary["orgs"] += 1

        # applications
        try:
            apps = sb.select("applications", {
                "org_id": f"eq.{org['id']}", "created_at": f"lt.{cutoff}",
                "purged_at": "is.null", "select": "id,resume_id", "limit": "500",
            })
        except Exception as e:  # noqa: BLE001
            log.warning("retention: app query failed for %s: %s", org["id"], e)
            apps = []
        if apps:
            summary["resumes"] += _delete_resumes([a.get("resume_id") for a in apps])
            for a in apps:
                try:
                    sb.update("applications", {"id": f"eq.{a['id']}"}, {
                        "name": REDACTED, "email": f"purged+{a['id'][:8]}@invalid",
                        "phone": None, "location": None, "cover_note": None,
                        "current_company": None, "current_title": None,
                        "expected_salary": None, "notice_period": None,
                        "links": {}, "parsed": None, "resume_id": None,
                        "purged_at": _now().isoformat(),
                    })
                    summary["applications"] += 1
                except Exception as e:  # noqa: BLE001
                    log.warning("retention: purge app %s failed: %s", a["id"], e)

        # saved runs
        try:
            runs = sb.select("screening_runs", {
                "org_id": f"eq.{org['id']}", "created_at": f"lt.{cutoff}",
                "select": "id,results,title", "limit": "100",
            })
        except Exception as e:  # noqa: BLE001
            log.warning("retention: run query failed for %s: %s", org["id"], e)
            runs = []
        for run in runs:
            results = run.get("results") or {}
            already = bool(results.get("_purged"))
            if already:
                continue
            redacted, n = _redact_results(results, None)
            if not n:
                continue
            redacted["_purged"] = _now().isoformat()
            try:
                sb.update("screening_runs", {"id": f"eq.{run['id']}"},
                          {"results": redacted, "top_name": REDACTED})
                summary["runs"] += 1
            except Exception as e:  # noqa: BLE001
                log.warning("retention: redact run %s failed: %s", run["id"], e)

        # resumes no longer referenced by any run or application
        try:
            sb.delete("run_resumes", {"run_id": "is.null"})
        except Exception:  # noqa: BLE001
            pass

    return summary


# -------------------------------------------------------- deletion requests
def erase_candidate(org_id: str, email: str) -> dict:
    """Erase one person from an org: applications, reviews, and run payloads."""
    if not supabase_configured():
        return {"ran": False, "reason": "supabase not configured"}
    low = (email or "").strip().lower()
    if not low:
        return {"ran": False, "reason": "no email"}
    out = {"ran": True, "applications": 0, "reviews": 0, "runs": 0, "resumes": 0}

    try:
        apps = sb.select("applications", {
            "org_id": f"eq.{org_id}", "email": f"ilike.{low}",
            "select": "id,resume_id",
        })
    except Exception as e:  # noqa: BLE001
        return {"ran": False, "reason": str(e)[:200]}
    if apps:
        out["resumes"] += _delete_resumes([a.get("resume_id") for a in apps])
        for a in apps:
            sb.update("applications", {"id": f"eq.{a['id']}"}, {
                "name": REDACTED, "email": f"erased+{a['id'][:8]}@invalid",
                "phone": None, "location": None, "cover_note": None,
                "current_company": None, "current_title": None,
                "expected_salary": None, "notice_period": None,
                "links": {}, "parsed": None, "resume_id": None,
                "purged_at": _now().isoformat(),
            })
            out["applications"] += 1

    try:
        reviews = sb.select("candidate_reviews", {
            "org_id": f"eq.{org_id}", "candidate_email": f"ilike.{low}", "select": "id",
        })
        for r in reviews:
            sb.update("candidate_reviews", {"id": f"eq.{r['id']}"}, {
                "candidate_name": REDACTED, "candidate_email": None, "notes": None,
            })
            out["reviews"] += 1
    except Exception as e:  # noqa: BLE001
        log.warning("erase: reviews failed: %s", e)

    try:
        runs = sb.select("screening_runs", {"org_id": f"eq.{org_id}",
                                            "select": "id,results", "limit": "500"})
        for run in runs:
            redacted, n = _redact_results(run.get("results") or {}, {low})
            if n:
                sb.update("screening_runs", {"id": f"eq.{run['id']}"}, {"results": redacted})
                out["runs"] += 1
    except Exception as e:  # noqa: BLE001
        log.warning("erase: runs failed: %s", e)

    return out


def process_deletion_requests(limit: int = 25) -> dict:
    if not supabase_configured():
        return {"ran": False, "reason": "supabase not configured"}
    try:
        reqs = sb.select("deletion_requests", {
            "status": "eq.pending", "order": "requested_at.asc", "limit": str(limit),
        })
    except Exception as e:  # noqa: BLE001
        return {"ran": False, "reason": str(e)[:200]}

    done = 0
    for r in reqs:
        try:
            res = erase_candidate(r["org_id"], r["email"])
            sb.update("deletion_requests", {"id": f"eq.{r['id']}"}, {
                "status": "completed",
                "processed_at": _now().isoformat(),
                "note": (f"Erased {res.get('applications', 0)} application(s), "
                         f"{res.get('reviews', 0)} review(s), "
                         f"{res.get('runs', 0)} run payload(s), "
                         f"{res.get('resumes', 0)} stored resume(s)."),
            })
            done += 1
        except Exception as e:  # noqa: BLE001
            log.warning("deletion request %s failed: %s", r["id"], e)
    return {"ran": True, "processed": done, "pending": len(reqs)}


def run_all() -> dict:
    return {"retention": sweep(), "deletions": process_deletion_requests()}


def _loop() -> None:
    log.info("retention worker started (every %sh)", RETENTION_TICK_HOURS)
    # Give the app a moment to finish starting before the first sweep.
    _stop.wait(120)
    while not _stop.is_set():
        try:
            out = run_all()
            log.info("retention sweep: %s", out)
        except Exception as e:  # noqa: BLE001
            log.warning("retention tick error: %s", e)
        _stop.wait(max(1, RETENTION_TICK_HOURS) * 3600)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="retention", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
