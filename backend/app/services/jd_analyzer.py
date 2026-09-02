"""Job-description quality analysis — better JDs produce better rankings."""
from __future__ import annotations

import re

from app.scoring.engine import JobPosting
from app.scoring.hybrid import extract_generic_requirements

_VAGUE = ("rockstar", "ninja", "guru", "wizard", "fast-paced", "dynamic",
          "self-starter", "go-getter", "work hard play hard", "hit the ground running")
_BIAS = ("young", "energetic", "native speaker", "recent graduate only", "digital native",
         "he", "his", "she", "her", "culture fit", "aggressive", "salesman", "manpower")
_MUST = ("must", "required", "essential", "need to", "should have", "minimum")


def _has_word(low: str, phrase: str) -> bool:
    return re.search(rf"\b{re.escape(phrase)}\b", low) is not None


def analyze(title: str, description: str) -> dict:
    job = JobPosting(title=title.strip(), description=description.strip())
    text = job.description
    low = text.lower()
    words = len(text.split())
    req = sorted(job.required_skills)
    extra = extract_generic_requirements(job)
    n_req = len(req) + len(extra)
    issues: list[dict] = []
    penalty = 0

    def issue(sev: str, msg: str, fix: str, pts: int):
        nonlocal penalty
        issues.append({"severity": sev, "message": msg, "suggestion": fix})
        penalty += pts

    if not job.title:
        issue("high", "No job title.", "Add a clear title — it drives the role-fit signal.", 15)
    if words < 40:
        issue("high", f"Very short description ({words} words).",
              "Add responsibilities and 5–8 concrete required skills.", 20)
    elif words < 80:
        issue("low", f"Short description ({words} words).",
              "A few more lines on responsibilities improves semantic matching.", 5)
    elif words > 700:
        issue("low", f"Long description ({words} words).",
              "Trim to the essentials; long JDs dilute semantic matching.", 5)
    if n_req == 0:
        issue("high", "No recognisable skills or requirements found.",
              "List specific tools/skills (e.g. 'Python, FastAPI, PostgreSQL').", 25)
    elif n_req > 12:
        issue("medium", f"{n_req} requirements — likely unrealistic.",
              "Mark 3–6 as must-have and move the rest to 'nice to have'.", 10)
    if job.required_years <= 0:
        issue("low", "No years of experience specified.",
              "Add e.g. '3+ years' so experience can be scored precisely.", 5)
    if not any(m in low for m in _MUST):
        issue("medium", "No must-have language detected.",
              "Use 'must have' / 'required' for critical skills, 'a plus' for optional ones.", 8)
    vague = [v for v in _VAGUE if _has_word(low, v)]
    if vague:
        issue("low", f"Vague buzzwords: {', '.join(vague)}.",
              "Replace with concrete expectations.", 5)
    bias = [b for b in _BIAS if _has_word(low, b)]
    if bias:
        issue("medium", f"Potentially biased wording: {', '.join(bias)}.",
              "Use neutral, skills-focused language.", 10)
    if "or" not in low and n_req >= 4:
        issue("info", "No alternatives listed.",
              "Where tools are interchangeable, say 'TensorFlow or PyTorch' — candidates with either will score fairly.", 0)

    score = max(0, 100 - penalty)
    grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 55 else "D"
    return {
        "score": score,
        "grade": grade,
        "stats": {
            "words": words,
            "requirements": n_req,
            "taxonomy_skills": req,
            "extracted_requirements": extra,
            "years_specified": job.required_years,
        },
        "issues": issues,
    }
