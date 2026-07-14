"""Extract structured fields from raw resume text."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.scoring.skills import canonical_skills_in

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
# International-ish phone: optional +, groups of digits with separators, 9-15 digits total.
PHONE_RE = re.compile(
    r"(?:(?:\+|00)\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,4}\d{2,4}"
)
# "5 years", "5+ yrs", "over 7 years of experience"
EXP_RE = re.compile(
    r"(\d{1,2})\s*\+?\s*(?:years|yrs|year)\b",
    re.IGNORECASE,
)

_NON_NAME = re.compile(r"[0-9@|]|resume|curriculum|vitae|cv\b", re.IGNORECASE)


@dataclass
class ParsedResume:
    filename: str
    name: str
    email: str
    phone: str
    experience_years: float
    skills: list[str] = field(default_factory=list)
    raw_text: str = ""

    def to_dict(self) -> dict:
        return {
            "filename": self.filename,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "experience_years": self.experience_years,
            "skills": self.skills,
        }


def _extract_email(text: str) -> str:
    m = EMAIL_RE.search(text)
    return m.group(0) if m else ""


def _extract_phone(text: str) -> str:
    for m in PHONE_RE.finditer(text):
        candidate = m.group(0).strip()
        digits = re.sub(r"\D", "", candidate)
        if 9 <= len(digits) <= 15:
            return candidate
    return ""


def _extract_experience(text: str) -> float:
    years = [int(m.group(1)) for m in EXP_RE.finditer(text)]
    return float(max(years)) if years else 0.0


def _extract_name(text: str, email: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # Heuristic 1: first few lines, pick a short line that looks like a name.
    for ln in lines[:8]:
        if _NON_NAME.search(ln):
            continue
        words = ln.split()
        if 1 < len(words) <= 4 and all(w[0].isalpha() for w in words):
            # Looks like "John A Doe" / "Jane Smith"
            if sum(1 for w in words if w[:1].isupper()) >= 2:
                return " ".join(words)
    # Heuristic 2: derive from email local-part.
    if email:
        local = email.split("@")[0]
        local = re.sub(r"[._\-]+", " ", local)
        local = re.sub(r"\d+", "", local).strip()
        if local:
            return local.title()
    return lines[0] if lines else "Unknown"


def parse_resume(filename: str, text: str) -> ParsedResume:
    email = _extract_email(text)
    return ParsedResume(
        filename=filename,
        name=_extract_name(text, email),
        email=email,
        phone=_extract_phone(text),
        experience_years=_extract_experience(text),
        skills=sorted(canonical_skills_in(text)),
        raw_text=text,
    )
