"""Shared screening pipeline used by both the upload and Gmail routes."""
from __future__ import annotations

import hashlib

from app.config import RESUME_CONFIDENCE_MIN
from app.parsing.extractor import UnsupportedFileType, extract_text
from app.parsing.resume_parser import parse_resume
from app.scoring.engine import JobPosting
from app.scoring.hybrid import (alternative_groups, extract_generic_requirements,
                                normalise_weights, score_batch)


def run_screening(
    title: str,
    description: str,
    top_n: int,
    files: list[tuple[str, bytes]],
    sources: dict[str, str] | None = None,
    weights: dict | None = None,
) -> dict:
    """Parse, hybrid-score, and rank a batch of resume files.

    Returns ranked candidates, the top-N shortlist, files that failed to parse,
    and documents flagged as "not a resume" (excluded from ranking).
    """
    job = JobPosting(title=title.strip(), description=description.strip())
    sources = sources or {}
    errors: list[dict] = []
    flagged: list[dict] = []
    parsed_list = []
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
                           "error": "No extractable text (scanned image? try OCR)."})
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
    return {
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
