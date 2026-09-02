"""Extract structured fields from raw resume text."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from app.scoring.skills import canonical_skills_in

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
_MONTH_RE = "|".join(_MONTHS)
# Matches "Jan 2020 - Present", "2019 – 2022", "Jun 2021 to Aug 2023", etc.
_RANGE_RE = re.compile(
    rf"(?:(?P<m1>{_MONTH_RE})[a-z]*\.?\s+)?(?P<y1>(?:19|20)\d{{2}})"
    r"\s*(?:-|–|—|to|until)\s*"
    rf"(?:(?P<m2>{_MONTH_RE})[a-z]*\.?\s+)?(?P<y2>(?:19|20)\d{{2}}|present|current|now|ongoing)",
    re.IGNORECASE,
)

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


_SECTION_HEADERS = (
    "experience", "work experience", "employment", "professional experience",
    "education", "skills", "technical skills", "projects", "summary",
    "objective", "certifications", "achievements", "internship",
)


@dataclass
class ParsedResume:
    filename: str
    name: str
    email: str
    phone: str
    experience_years: float
    skills: list[str] = field(default_factory=list)
    raw_text: str = ""
    confidence: float = 1.0          # 0..1 — how much this looks like a resume
    confidence_reasons: list[str] = field(default_factory=list)
    word_count: int = 0

    def to_dict(self) -> dict:
        return {
            "filename": self.filename,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "experience_years": self.experience_years,
            "skills": self.skills,
            "confidence": self.confidence,
            "word_count": self.word_count,
        }


def resume_confidence(text: str, email: str, phone: str,
                      skills: list[str], years: float) -> tuple[float, list[str]]:
    """Heuristic 0..1 score for 'is this document actually a resume/CV?'.

    Non-resumes (letters, forms, random PDFs) lack contact info, skills,
    section headers and employment date ranges, and tend to be short.
    """
    low = text.lower()
    words = len(text.split())
    score = 0.0
    reasons: list[str] = []

    if email:
        score += 0.2
    else:
        reasons.append("no email found")
    if phone:
        score += 0.1
    else:
        reasons.append("no phone found")

    hdrs = sum(1 for h in _SECTION_HEADERS if re.search(rf"\b{re.escape(h)}\b", low))
    if hdrs >= 2:
        score += 0.25
    elif hdrs == 1:
        score += 0.12
    else:
        reasons.append("no resume sections (experience/education/skills)")

    if len(skills) >= 3:
        score += 0.2
    elif len(skills) >= 1:
        score += 0.1
    else:
        reasons.append("no recognisable skills")

    if years > 0 or _RANGE_RE.search(text):
        score += 0.15
    else:
        reasons.append("no employment dates")

    if words >= 150:
        score += 0.1
    elif words < 80:
        reasons.append(f"very short ({words} words)")

    return round(min(score, 1.0), 2), reasons


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


_EDU_WORDS = re.compile(
    r"\b(university|institute|college|school|academy|b\.?tech|m\.?tech|bachelor|master|"
    r"b\.?sc|m\.?sc|bca|mca|mba|phd|degree|diploma|cgpa|gpa|graduat|class of|"
    r"secondary|hsc|ssc|cbse|icse|coursework|semester|sansthan|shikshan|vidyalaya|"
    r"vidya|mahavidyalaya|polytechnic|iit|nit|iiit|education)\b",
    re.IGNORECASE,
)


def _line_at(text: str, pos: int) -> str:
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    return text[start: end if end != -1 else len(text)]


def _years_from_ranges(text: str) -> float:
    """Estimate experience by summing employment date ranges (deduped, merged),
    ignoring ranges that belong to education entries."""
    today = date.today()
    intervals: list[tuple[float, float]] = []
    for m in _RANGE_RE.finditer(text):
        ctx = _line_at(text, m.start())
        # also peek at the previous line (institution name often sits above dates)
        prev_end = text.rfind("\n", 0, max(0, text.rfind("\n", 0, m.start())))
        prev = text[prev_end + 1: text.rfind("\n", 0, m.start())] if prev_end >= 0 else ""
        if _EDU_WORDS.search(ctx) or _EDU_WORDS.search(prev):
            continue
        start_y = int(m.group("y1"))
        m1 = _MONTHS.get((m.group("m1") or "").lower(), 1) if m.group("m1") else 1
        end_raw = m.group("y2").lower()
        if end_raw in ("present", "current", "now", "ongoing"):
            end_y, m2 = today.year, today.month
        else:
            end_y = int(end_raw)
            m2 = _MONTHS.get((m.group("m2") or "").lower(), 12) if m.group("m2") else 12
        start = start_y + (m1 - 1) / 12.0
        end = end_y + m2 / 12.0  # end month counted inclusively (May–Aug = 4 months)
        if 1970 <= start_y <= today.year and end >= start and (end - start) <= 45:
            intervals.append((start, end))

    if not intervals:
        return 0.0
    # Merge overlapping intervals so concurrent roles don't double-count.
    intervals.sort()
    merged: list[list[float]] = [list(intervals[0])]
    for s, e in intervals[1:]:
        if s <= merged[-1][1] + 0.001:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    total = sum(e - s for s, e in merged)
    return round(total, 1)


def _extract_experience(text: str) -> float:
    explicit = [int(m.group(1)) for m in EXP_RE.finditer(text)]
    explicit_max = float(max(explicit)) if explicit else 0.0
    from_dates = _years_from_ranges(text)
    return max(explicit_max, from_dates)


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
    phone = _extract_phone(text)
    years = _extract_experience(text)
    skills = sorted(canonical_skills_in(text))
    conf, reasons = resume_confidence(text, email, phone, skills, years)
    return ParsedResume(
        filename=filename,
        name=_extract_name(text, email),
        email=email,
        phone=phone,
        experience_years=years,
        skills=skills,
        raw_text=text,
        confidence=conf,
        confidence_reasons=reasons,
        word_count=len(text.split()),
    )
