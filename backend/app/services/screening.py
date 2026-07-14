"""Shared screening pipeline used by both the upload and Gmail routes."""
from __future__ import annotations

from app.parsing.extractor import UnsupportedFileType, extract_text
from app.parsing.resume_parser import parse_resume
from app.scoring.engine import JobPosting, score_resume


def run_screening(
    title: str,
    description: str,
    top_n: int,
    files: list[tuple[str, bytes]],
    sources: dict[str, str] | None = None,
) -> dict:
    """Score and rank a batch of resume files.

    Args:
        files: list of (filename, raw_bytes).
        sources: optional map filename -> human label of where it came from
                 (e.g. the email subject/sender), surfaced in the result.
    """
    job = JobPosting(title=title.strip(), description=description.strip())
    sources = sources or {}
    results: list[dict] = []
    seen_hashes: set[int] = set()

    for filename, data in files:
        try:
            text = extract_text(filename, data)
        except UnsupportedFileType as e:
            results.append({"filename": filename, "error": str(e)})
            continue
        if not text.strip():
            results.append({"filename": filename,
                            "error": "Could not extract any text."})
            continue

        h = hash(text.strip())
        if h in seen_hashes:
            continue
        seen_hashes.add(h)

        parsed = parse_resume(filename, text)
        sc = score_resume(parsed, job)
        item = parsed.to_dict()
        item.update({
            "score": sc.total,
            "breakdown": sc.breakdown,
            "matched_skills": sc.matched_skills,
            "missing_skills": sc.missing_skills,
            "source": sources.get(filename, ""),
        })
        results.append(item)

    ranked = [r for r in results if "error" not in r]
    errors = [r for r in results if "error" in r]
    ranked.sort(key=lambda r: (r["score"], r["experience_years"]), reverse=True)
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i

    top_n = max(1, top_n)
    return {
        "job": {"title": job.title, "required_years": job.required_years,
                "required_skills": sorted(job.required_skills)},
        "total_resumes": len(files),
        "ranked": ranked,
        "top": ranked[:top_n],
        "top_n": top_n,
        "errors": errors,
    }
