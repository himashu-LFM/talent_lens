"""Structured career profile: roles with tenure, gaps, seniority, education.

The base parser already reads employment date ranges to total up experience.
This module keeps the *shape* of that history — which employer, which title,
how long, in what order — which is what unlocks the signals a recruiter
actually scans for: "three jobs in two years", "an eight-month gap", "titles
are senior but tenure is junior".

Everything here is derived from the resume text alone. No inference about the
person, only about their stated history.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date

from app.parsing.resume_parser import _EDU_WORDS, _MONTHS, _RANGE_RE

_TITLE_WORDS = (
    r"engineer|developer|programmer|analyst|scientist|architect|administrator|"
    r"manager|director|consultant|specialist|associate|assistant|executive|"
    r"designer|researcher|lead|head|officer|intern|trainee|apprentice|"
    r"technician|strategist|coordinator|recruiter|accountant|marketer|"
    r"president|founder|partner|principal|staff|chief|cto|ceo|cfo|vp"
)
_TITLE_RE = re.compile(rf"\b({_TITLE_WORDS})\b", re.IGNORECASE)

_COMPANY_CUES = re.compile(
    r"\b(inc|llc|ltd|limited|pvt|private|plc|gmbh|corp|corporation|company|co|"
    r"technologies|technology|solutions|systems|labs|laburatories|laboratories|"
    r"software|consulting|services|group|holdings|ventures|studio|agency|media|"
    r"bank|capital|partners|industries|enterprises|global|international)\b\.?",
    re.IGNORECASE,
)

_SENIORITY = [
    ("executive", re.compile(r"\b(chief|cto|ceo|cfo|coo|vp|vice president|president|"
                             r"founder|co-founder|head of|director)\b", re.I)),
    ("principal", re.compile(r"\b(principal|distinguished|staff engineer|fellow)\b", re.I)),
    ("lead", re.compile(r"\b(lead|team lead|tech lead|manager|architect|supervisor)\b", re.I)),
    ("senior", re.compile(r"\b(senior|sr\.?|snr)\b", re.I)),
    ("junior", re.compile(r"\b(junior|jr\.?|associate|entry[- ]level|graduate|fresher)\b", re.I)),
    ("intern", re.compile(r"\b(intern|internship|trainee|apprentice|co-?op)\b", re.I)),
]

_EDU_LEVELS = [
    ("doctorate", re.compile(r"\b(ph\.?\s?d|doctorate|doctoral|d\.?phil)\b", re.I)),
    ("master", re.compile(r"\b(m\.?\s?tech|m\.?\s?sc|m\.?\s?s\b|m\.?\s?a\b|mba|m\.?c\.?a|"
                          r"master'?s?|post[- ]?graduate|pgdm|m\.?com|m\.?e\b)\b", re.I)),
    ("bachelor", re.compile(r"\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?s\b|b\.?\s?a\b|"
                            r"b\.?c\.?a|b\.?com|bachelor'?s?|under[- ]?graduate)\b", re.I)),
    ("diploma", re.compile(r"\b(diploma|polytechnic|associate degree|certificat)\w*\b", re.I)),
    ("secondary", re.compile(r"\b(higher secondary|hsc|ssc|12th|10th|cbse|icse|a[- ]levels)\b", re.I)),
]

_GAP_MIN_MONTHS = 4
_HOP_TENURE_MONTHS = 18
_SECTION_STOP = re.compile(
    r"^\s*(education|skills?|technical skills|projects?|certifications?|awards?|"
    r"publications?|summary|objective|interests?|languages?|references?)\s*:?\s*$",
    re.IGNORECASE,
)


@dataclass
class Role:
    title: str = ""
    company: str = ""
    start: str = ""          # "YYYY-MM"
    end: str = ""            # "YYYY-MM" or "present"
    months: int = 0
    current: bool = False


@dataclass
class CareerProfile:
    roles: list[dict] = field(default_factory=list)
    current_title: str = ""
    current_company: str = ""
    seniority: str = ""
    total_months: int = 0
    avg_tenure_months: int = 0
    role_count: int = 0
    gaps: list[dict] = field(default_factory=list)
    longest_gap_months: int = 0
    job_hopping: bool = False
    flags: list[str] = field(default_factory=list)
    education_level: str = ""
    education: list[dict] = field(default_factory=list)
    grad_year: int | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _ym(year: int, month: int) -> str:
    return f"{year:04d}-{max(1, min(12, month)):02d}"


def _months_between(y1: int, m1: int, y2: int, m2: int) -> int:
    return max(0, (y2 - y1) * 12 + (m2 - m1) + 1)


def _lines(text: str) -> list[str]:
    return [ln.rstrip() for ln in text.splitlines()]


_SECTION_WORD = re.compile(
    r"\b(work\s+)?(experience|employment|education|skills?|projects?|summary|"
    r"objective|certifications?|achievements?|internship|profile|career\s+history)\b\s*:?",
    re.IGNORECASE,
)


def _clean_fragment(s: str) -> str:
    """Strip the date range, section headings and separators out of a line,
    leaving just the role/company label."""
    s = _RANGE_RE.sub(" ", s)
    s = re.sub(r"\b(19|20)\d{2}\b", " ", s)
    # A heading glued onto the line ("… Bengaluru EXPERIENCE") is noise, not a company.
    s = _SECTION_WORD.sub(" ", s)
    s = re.sub(r"[|•·–—\t]+", " ", s)
    s = re.sub(r"\s*[,;]\s*$", "", s)
    s = re.sub(r"\s+", " ", s).strip(" -–—,:|·•")
    return s


def _looks_like_company(s: str) -> bool:
    return bool(_COMPANY_CUES.search(s)) or (
        len(s.split()) <= 5 and not _TITLE_RE.search(s) and bool(re.search(r"[A-Za-z]", s))
    )


def _split_title_company(fragment: str) -> tuple[str, str]:
    """A single line often carries both: "Senior ML Engineer, Fintech Labs"."""
    if not fragment:
        return "", ""
    # Split on commas without requiring surrounding spaces, so
    # "Nimbus Labs, Bengaluru" yields the company on its own.
    parts = [p.strip(" -–—,:|·•") for p in
             re.split(r"\s*[,;|·•]\s*|\s+(?:at|@|-|–|—)\s+", fragment)
             if p.strip(" -–—,:|·•")]
    if len(parts) >= 2:
        title = next((p for p in parts if _TITLE_RE.search(p)), "")
        if title:
            company = next((p for p in parts if p != title and _looks_like_company(p)), "")
            if not company:
                company = next((p for p in parts if p != title), "")
            return title[:90], company[:90]
        return parts[0][:90], parts[1][:90]
    if _TITLE_RE.search(fragment):
        return fragment[:90], ""
    return "", fragment[:90]


def _context(lines: list[str], idx: int) -> str:
    """Best-effort label for the role whose dates sit on line `idx`: the line
    itself, plus the nearest non-empty lines above and below."""
    own = _clean_fragment(lines[idx])
    if own and (_TITLE_RE.search(own) or len(own.split()) >= 2):
        above = ""
        j = idx - 1
        while j >= 0 and not lines[j].strip():
            j -= 1
        if j >= 0 and not _SECTION_STOP.match(lines[j]):
            above = _clean_fragment(lines[j])
        if above and _TITLE_RE.search(above) and not _TITLE_RE.search(own):
            return f"{above}, {own}"
        if above and _TITLE_RE.search(own) and _looks_like_company(above):
            return f"{own}, {above}"
        return own

    for j in (idx - 1, idx + 1, idx - 2, idx + 2):
        if 0 <= j < len(lines) and lines[j].strip() and not _SECTION_STOP.match(lines[j]):
            frag = _clean_fragment(lines[j])
            if frag and len(frag) <= 120:
                return f"{frag}, {own}".strip(", ") if own else frag
    return own


def _education_entries(text: str) -> tuple[str, list[dict], int | None]:
    level = ""
    for name, rx in _EDU_LEVELS:
        if rx.search(text):
            level = name
            break
    entries: list[dict] = []
    years: list[int] = []
    for ln in _lines(text):
        if not ln.strip() or not _EDU_WORDS.search(ln):
            continue
        frag = _clean_fragment(ln)
        yrs = [int(y) for y in re.findall(r"\b(?:19|20)\d{2}\b", ln)]
        years.extend(yrs)
        if frag and len(entries) < 6:
            entry = {"text": frag[:140]}
            if yrs:
                entry["year"] = max(yrs)
            entries.append(entry)
    grad_year = max(years) if years else None
    if grad_year and grad_year > date.today().year + 6:
        grad_year = None
    return level, entries, grad_year


def build_profile(text: str) -> CareerProfile:
    """Derive the career shape from resume text. Never raises."""
    try:
        return _build(text)
    except Exception:  # noqa: BLE001 — a parsing quirk must not fail a screening
        return CareerProfile()


def _build(text: str) -> CareerProfile:
    today = date.today()
    lines = _lines(text)
    # Map absolute character offsets to line indexes so regex hits find their line.
    starts: list[int] = []
    pos = 0
    for ln in lines:
        starts.append(pos)
        pos += len(ln) + 1

    def line_index(offset: int) -> int:
        lo, hi = 0, len(starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if starts[mid] <= offset:
                lo = mid
            else:
                hi = mid - 1
        return lo

    roles: list[Role] = []
    intervals: list[tuple[float, float]] = []

    for m in _RANGE_RE.finditer(text):
        idx = line_index(m.start())
        own = lines[idx] if idx < len(lines) else ""
        prev = lines[idx - 1] if idx > 0 else ""
        if _EDU_WORDS.search(own) or _EDU_WORDS.search(prev):
            continue

        y1 = int(m.group("y1"))
        m1 = _MONTHS.get((m.group("m1") or "").lower(), 1) if m.group("m1") else 1
        end_raw = m.group("y2").lower()
        current = end_raw in ("present", "current", "now", "ongoing")
        if current:
            y2, m2 = today.year, today.month
        else:
            y2 = int(end_raw)
            m2 = _MONTHS.get((m.group("m2") or "").lower(), 12) if m.group("m2") else 12

        if not (1970 <= y1 <= today.year + 1):
            continue
        span = _months_between(y1, m1, y2, m2)
        if span <= 0 or span > 45 * 12:
            continue

        title, company = _split_title_company(_context(lines, idx))
        roles.append(Role(
            title=title, company=company,
            start=_ym(y1, m1), end="present" if current else _ym(y2, m2),
            months=span, current=current,
        ))
        intervals.append((y1 + (m1 - 1) / 12.0, y2 + m2 / 12.0))

    roles.sort(key=lambda r: r.start, reverse=True)

    # Total experience: merge overlaps so concurrent roles don't double-count.
    total_months = 0
    merged: list[list[float]] = []
    if intervals:
        intervals.sort()
        merged = [list(intervals[0])]
        for s, e in intervals[1:]:
            if s <= merged[-1][1] + 0.001:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        total_months = int(round(sum(e - s for s, e in merged) * 12))

    # Gaps between merged employment blocks (ignores pre-career time).
    gaps: list[dict] = []
    for i in range(1, len(merged)):
        gap_years = merged[i][0] - merged[i - 1][1]
        gap_months = int(round(gap_years * 12))
        if gap_months >= _GAP_MIN_MONTHS:
            def fmt(v: float) -> str:
                y = int(v)
                mo = min(12, max(1, int(round((v - y) * 12)) or 1))
                return _ym(y, mo)
            gaps.append({"from": fmt(merged[i - 1][1]), "to": fmt(merged[i][0]),
                         "months": gap_months})
    longest_gap = max((g["months"] for g in gaps), default=0)

    current_role = next((r for r in roles if r.current), roles[0] if roles else None)
    seniority = ""
    title_pool = " ".join(r.title for r in roles[:3]) or text[:400]
    for name, rx in _SENIORITY:
        if rx.search(title_pool):
            seniority = name
            break
    if not seniority and roles:
        seniority = "mid"

    real_roles = [r for r in roles if r.months >= 2]
    avg_tenure = int(round(sum(r.months for r in real_roles) / len(real_roles))) if real_roles else 0
    hopping = len(real_roles) >= 3 and avg_tenure < _HOP_TENURE_MONTHS

    flags: list[str] = []
    if hopping:
        flags.append(f"{len(real_roles)} roles averaging {avg_tenure} months each")
    if longest_gap >= 6:
        flags.append(f"{longest_gap}-month gap in employment history")
    if seniority in ("senior", "lead", "principal", "executive") and 0 < total_months < 36:
        flags.append(f"senior-sounding title with ~{total_months // 12} yrs of dated history")
    if roles and not any(r.current for r in roles):
        flags.append("no current role listed")

    level, edu, grad_year = _education_entries(text)

    return CareerProfile(
        roles=[asdict(r) for r in roles[:12]],
        current_title=(current_role.title if current_role else ""),
        current_company=(current_role.company if current_role else ""),
        seniority=seniority,
        total_months=total_months,
        avg_tenure_months=avg_tenure,
        role_count=len(real_roles),
        gaps=gaps[:6],
        longest_gap_months=longest_gap,
        job_hopping=hopping,
        flags=flags,
        education_level=level,
        education=edu,
        grad_year=grad_year,
    )
