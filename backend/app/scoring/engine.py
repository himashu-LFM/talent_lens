"""Transparent, rule-based scoring of a resume against a job posting.

No LLM calls. Every score traces back to concrete matched / missing terms.

Weight breakdown (sums to 100):
    skills       55   canonical skills required by the JD that appear in the resume
    role/title   20   words from the job title present in the resume
    experience   15   resume experience vs. years requested in the JD
    keywords     10   overlap of other significant JD keywords
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.parsing.resume_parser import ParsedResume
from app.scoring.skills import canonical_skills_in, contains_term

WEIGHTS = {"skills": 55, "role": 20, "experience": 15, "keywords": 10}

_STOPWORDS = {
    "the", "and", "for", "with", "you", "your", "our", "will", "are", "who",
    "this", "that", "have", "has", "from", "should", "must", "able", "work",
    "team", "role", "join", "looking", "experience", "years", "year", "job",
    "we", "a", "an", "to", "of", "in", "on", "as", "is", "be", "or", "at",
    "candidate", "candidates", "responsibilities", "requirements", "plus",
    "strong", "good", "excellent", "including", "etc", "using", "about",
}
_WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+#.\-]{2,}")


@dataclass
class JobPosting:
    title: str
    description: str

    @property
    def required_years(self) -> float:
        m = re.search(r"(\d{1,2})\s*\+?\s*(?:years|yrs)", self.description, re.I)
        return float(m.group(1)) if m else 0.0

    @property
    def required_skills(self) -> set[str]:
        return canonical_skills_in(f"{self.title} {self.description}")

    @property
    def title_keywords(self) -> list[str]:
        return [w.lower() for w in _WORD_RE.findall(self.title)
                if w.lower() not in _STOPWORDS]

    @property
    def keywords(self) -> set[str]:
        words = {w.lower() for w in _WORD_RE.findall(self.description)}
        return {w for w in words if w not in _STOPWORDS}


@dataclass
class ScoreResult:
    total: float
    breakdown: dict
    matched_skills: list[str]
    missing_skills: list[str]


def _pct(part: float, whole: float) -> float:
    return (part / whole) if whole else 1.0


def score_resume(resume: ParsedResume, job: JobPosting) -> ScoreResult:
    text = resume.raw_text

    # --- Skills ---
    req_skills = job.required_skills
    matched = sorted(s for s in req_skills if s in set(resume.skills))
    missing = sorted(req_skills - set(matched))
    skills_ratio = _pct(len(matched), len(req_skills))
    skills_score = skills_ratio * WEIGHTS["skills"]

    # --- Role / title ---
    title_kw = job.title_keywords
    title_hits = [w for w in title_kw if contains_term(text, w)]
    role_ratio = _pct(len(title_hits), len(title_kw))
    role_score = role_ratio * WEIGHTS["role"]

    # --- Experience ---
    req_years = job.required_years
    if req_years <= 0:
        exp_ratio = 1.0
    else:
        exp_ratio = min(resume.experience_years / req_years, 1.0)
    exp_score = exp_ratio * WEIGHTS["experience"]

    # --- Other keywords ---
    kws = job.keywords
    kw_hits = [w for w in kws if contains_term(text, w)]
    kw_ratio = _pct(len(kw_hits), len(kws))
    kw_score = kw_ratio * WEIGHTS["keywords"]

    total = round(skills_score + role_score + exp_score + kw_score, 1)

    breakdown = {
        "skills": {
            "score": round(skills_score, 1), "max": WEIGHTS["skills"],
            "matched": len(matched), "required": len(req_skills),
        },
        "role": {
            "score": round(role_score, 1), "max": WEIGHTS["role"],
            "matched": len(title_hits), "required": len(title_kw),
        },
        "experience": {
            "score": round(exp_score, 1), "max": WEIGHTS["experience"],
            "candidate_years": resume.experience_years,
            "required_years": req_years,
        },
        "keywords": {
            "score": round(kw_score, 1), "max": WEIGHTS["keywords"],
            "matched": len(kw_hits), "required": len(kws),
        },
    }
    return ScoreResult(total, breakdown, matched, missing)
