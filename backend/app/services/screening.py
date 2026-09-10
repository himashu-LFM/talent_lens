"""Shared screening pipeline used by the upload, Gmail and public-intake routes."""
from __future__ import annotations

import hashlib
import logging

from app.config import RESUME_CONFIDENCE_MIN
from app.parsing.extractor import UnsupportedFileType, extract_text
from app.parsing.resume_parser import ParsedResume, parse_resume
from app.scoring.engine import JobPosting
from app.scoring.hybrid import (alternative_groups, extract_generic_requirements,
                                normalise_weights, score_batch)

log = logging.getLogger("talentlens.screening")


def parse_files(
    files: list[tuple[str, bytes]],
    sources: dict[str, str] | None = None,
) -> tuple[list[ParsedResume], list[dict], list[dict]]:
    """Extract + parse a batch. Returns (parsed, errors, flagged-as-not-a-resume)."""
    sources = sources or {}
    errors: list[dict] = []
    flagged: list[dict] = []
    parsed_list: list[ParsedResume] = []
    seen: set[str] = set()

    for filename, data in files:
        try:
            text = extract_text(filename, data)
        except UnsupportedFileType as e:
            errors.append({"filename": filename, "error": str(e)})
            continue
        except Exception as e:  # corrupt / password-protected files etc.
            errors.append({"filename": filename, "error": f"Could not read file: {e}"})
            continue
        if not text.strip():
            errors.append({"filename": filename,
                           "error": "No extractable text — the file may be an unreadable scan."})
            continue

        digest = hashlib.sha1(text.strip().encode("utf-8", "ignore")).hexdigest()
        if digest in seen:
            errors.append({"filename": filename, "error": "Duplicate of another file - skipped."})
            continue
        seen.add(digest)

        parsed = parse_resume(filename, text)
        if parsed.confidence < RESUME_CONFIDENCE_MIN:
            flagged.append({
                "filename": filename,
                "name": parsed.name,
                "confidence": parsed.confidence,
                "reasons": parsed.confidence_reasons,
                "source": sources.get(filename, ""),
            })
            continue
        parsed_list.append(parsed)

    return parsed_list, errors, flagged


def run_screening(
    title: str,
    description: str,
    top_n: int,
    files: list[tuple[str, bytes]],
    sources: dict[str, str] | None = None,
    weights: dict | None = None,
    audit: bool = False,
    deep: bool = False,
    deep_top_n: int = 0,
) -> dict:
    """Parse, hybrid-score, and rank a batch of resume files.

    Returns ranked candidates, the top-N shortlist, files that failed to parse,
    and documents flagged as "not a resume" (excluded from ranking).

    `audit` adds a fairness report (re-scores everyone with identity removed).
    `deep` adds an LLM assessment of the shortlist when a key is configured.
    """
    job = JobPosting(title=title.strip(), description=description.strip())
    sources = sources or {}
    parsed_list, errors, flagged = parse_files(files, sources)
    scores = score_batch(parsed_list, job, weights)

    ranked: list[dict] = []
    for parsed, sc in zip(parsed_list, scores):
        item = parsed.to_dict()
        item.update({
            "score": sc.total,
            "breakdown": sc.breakdown,
            "matched_skills": sc.matched_skills,
            "missing_skills": sc.missing_skills,
            "evidence": sc.evidence,
            "best_match_snippet": sc.semantic_snippet,
            "improvements": sc.improvements,
            "brief": sc.brief,
            "interview_questions": sc.questions,
            "duplicate_group": sc.duplicate_group,
            "source": sources.get(parsed.filename, ""),
        })
        ranked.append(item)

    ranked.sort(key=lambda r: (r["score"], r["experience_years"]), reverse=True)
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i

    top_n = max(1, top_n)
    out = {
        "job": {
            "title": job.title,
            "required_years": job.required_years,
            "required_skills": sorted(job.required_skills),
            "extra_requirements": extract_generic_requirements(job),
            "alternative_groups": [sorted(g) for g in alternative_groups(job)],
            "weights": normalise_weights(weights),
        },
        "total_resumes": len(files),
        "ranked": ranked,
        "top": ranked[:top_n],
        "top_n": top_n,
        "errors": errors,
        "flagged": flagged,
    }

    if audit and parsed_list:
        from app.services import bias
        try:
            out["bias_audit"] = bias.build_report(
                parsed_list, job, [s.total for s in scores], score_batch, weights
            )
        except Exception as e:  # noqa: BLE001
            log.warning("bias audit failed: %s", e)
            out["bias_audit"] = {"error": str(e)[:200]}

    if deep and ranked:
        from app.services import llm
        by_name = {p.filename: p for p in parsed_list}
        limit = deep_top_n or top_n
        payload = [{
            "filename": c["filename"],
            "resume_text": by_name[c["filename"]].raw_text if c["filename"] in by_name else "",
            "score": c["score"],
            "matched_skills": c["matched_skills"],
            "missing_skills": c["missing_skills"],
        } for c in ranked[:limit]]
        try:
            result = llm.deep_dive(job.title, job.description, payload, top_n=limit)
            out["llm"] = {k: v for k, v in result.items() if k != "assessments"}
            assessments = result.get("assessments", {})
            for c in ranked:
                a = assessments.get(c["filename"])
                if a:
                    c["ai"] = a
        except Exception as e:  # noqa: BLE001
            log.warning("LLM deep-dive failed: %s", e)
            out["llm"] = {"ran": False, "reason": str(e)[:200]}

    return out


def match_against_roles(
    filename: str,
    data: bytes,
    roles: list[dict],
    weights: dict | None = None,
) -> dict:
    """Score ONE resume against several open roles — "which of our jobs does this
    person actually fit?". `roles` items need id/title/description.
    """
    parsed_list, errors, flagged = parse_files([(filename, data)])
    if not parsed_list:
        problem = (errors or flagged or [{}])[0]
        return {
            "filename": filename,
            "error": problem.get("error") or "That file didn't look like a resume.",
            "reasons": problem.get("reasons", []),
            "matches": [],
        }

    parsed = parsed_list[0]
    matches: list[dict] = []
    for role in roles:
        job = JobPosting(title=(role.get("title") or "").strip(),
                         description=(role.get("description") or "").strip())
        try:
            sc = score_batch([parsed], job, role.get("weights") or weights)[0]
        except Exception as e:  # noqa: BLE001
            log.warning("role match failed for %s: %s", role.get("title"), e)
            continue
        matches.append({
            "job_id": role.get("id"),
            "title": job.title or "Untitled role",
            "score": sc.total,
            "breakdown": sc.breakdown,
            "matched_skills": sc.matched_skills,
            "missing_skills": sc.missing_skills,
            "required_years": job.required_years,
            "meets_experience": (job.required_years == 0
                                 or parsed.experience_years >= job.required_years),
            "headline": (sc.brief or {}).get("headline", ""),
        })

    matches.sort(key=lambda m: m["score"], reverse=True)
    best = matches[0] if matches else None
    return {
        "filename": filename,
        "candidate": parsed.to_dict(),
        "matches": matches,
        "best_fit": best,
        "verdict": (
            f"Best fit: {best['title']} ({best['score']:g}/100)"
            if best else "No open roles to compare against."
        ),
    }
