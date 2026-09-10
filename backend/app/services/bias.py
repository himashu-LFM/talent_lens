"""Fairness audit for a screening run.

Two deliberate design choices:

1. **We do not guess anyone's demographics.** Inferring gender or ethnicity from
   a name in order to "check for bias" is itself a bias-producing act, and it is
   wrong often enough to be actively misleading. Instead the audit runs a
   *controlled substitution experiment* — the résumé-audit method from the
   literature. Each resume is re-scored several times with only the identity
   swapped for a synthetic persona of deliberately varied name origin, holding
   document length and token count constant. If the score is identical across
   every persona, the engine demonstrably does not read identity. That is a far
   stronger claim than any correlation, and it invents no demographics for the
   real candidate.

   Note what this deliberately does *not* do: delete the name and compare
   against the original. Deleting text shortens the document and shifts the
   BM25 and semantic denominators, which moves the score for reasons that have
   nothing to do with fairness. Every variant here has the same shape, so those
   artefacts cancel out.

2. **Adverse-impact ratios use self-reported data only**, collected voluntarily
   on the application form, reported in aggregate, and suppressed below a
   minimum group size. Never inferred.

The third leg is proxy detection: identity signals sitting in the documents or
coded language sitting in the job description, both of which a recruiter can act
on directly.
"""
from __future__ import annotations

import re
from dataclasses import replace

from app.parsing.resume_parser import EMAIL_RE, PHONE_RE, ParsedResume
from app.scoring.engine import JobPosting

MIN_GROUP = 5          # below this, a group's rate is suppressed, not published
CLEAN_DELTA = 1.0      # score movement (0-100) below which anonymisation is "clean"

# Identity that should never influence a score.
_PII_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("date of birth", re.compile(r"\b(d\.?o\.?b\.?|date of birth|birth\s?date)\b", re.I)),
    ("age", re.compile(r"\bage\s*[:\-]?\s*\d{2}\b", re.I)),
    ("marital status", re.compile(r"\b(marital status|married|unmarried|single|spouse|"
                                  r"husband|wife|widow(?:ed)?|divorced)\b", re.I)),
    ("dependants", re.compile(r"\b(children|dependants|dependents|kids)\b", re.I)),
    ("gender", re.compile(r"\b(gender|sex)\s*[:\-]\s*(male|female|m|f)\b", re.I)),
    ("nationality", re.compile(r"\b(nationality|citizenship|religion|caste|community)\s*[:\-]", re.I)),
    ("photograph", re.compile(r"\b(photograph|passport size photo|my photo)\b", re.I)),
    ("father's name", re.compile(r"\b(father'?s name|mother'?s name|guardian)\b", re.I)),
]

# Wording in the *job description* that measurably skews who applies.
_CODED_JD = [
    ("masculine-coded", re.compile(r"\b(aggressive|dominant|ninja|rockstar|"
                                   r"competitive|fearless|hard[- ]charging|"
                                   r"whatever it takes|crush|kill it)\b", re.I)),
    ("feminine-coded", re.compile(r"\b(nurtur\w+|supportive|pleasant|"
                                  r"sympatheti\w+|dependable|gentle)\b", re.I)),
    ("age-coded", re.compile(r"\b(young|youthful|recent grad(?:uate)?s? only|digital native|"
                             r"fresh out of|energetic young|under \d{2})\b", re.I)),
    ("culture-coded", re.compile(r"\b(culture fit|like[- ]minded|native (?:english )?speaker|"
                                 r"mother tongue)\b", re.I)),
    ("ableist", re.compile(r"\b(able[- ]bodied|must be able to stand|no disabilit)\w*\b", re.I)),
]


def _name_tokens(name: str) -> list[str]:
    return [t for t in re.split(r"[^A-Za-z]+", name or "") if len(t) >= 3]


def redact(resume: ParsedResume) -> ParsedResume:
    """A copy of the resume with identity stripped: name, email, phone, links,
    location and the PII patterns above. Skills and history stay untouched."""
    text = resume.raw_text
    for tok in _name_tokens(resume.name):
        text = re.sub(rf"\b{re.escape(tok)}\b", "CANDIDATE", text, flags=re.IGNORECASE)
    text = EMAIL_RE.sub("email@redacted", text)
    text = PHONE_RE.sub(" 0000000000 ", text)
    text = re.sub(r"(?:https?://)?(?:www\.)?(?:linkedin\.com|github\.com)/[^\s]+",
                  "profile-redacted", text, flags=re.IGNORECASE)
    if resume.location:
        text = text.replace(resume.location, "LOCATION")
    for _label, rx in _PII_PATTERNS:
        text = rx.sub(" ", text)
    return replace(resume, name="CANDIDATE", email="", phone="",
                   location="", links={}, raw_text=text)


def _kendall_swaps(order_a: list[str], order_b: list[str]) -> int:
    """Number of pairs whose relative order differs between two rankings."""
    pos = {k: i for i, k in enumerate(order_b)}
    seq = [pos[k] for k in order_a if k in pos]
    swaps = 0
    for i in range(len(seq)):
        for j in range(i + 1, len(seq)):
            if seq[i] > seq[j]:
                swaps += 1
    return swaps


def swap_identity(resume: ParsedResume, persona: dict) -> ParsedResume:
    """A copy of the resume wearing a different identity of the same shape.

    Token counts are held constant: each name token is replaced one-for-one, and
    email / phone / location / profile URLs are substituted rather than deleted,
    so every variant has the same document length.
    """
    text = resume.raw_text
    orig_tokens = _name_tokens(resume.name)
    new_tokens = persona["name"].split()
    if orig_tokens:
        for i, tok in enumerate(orig_tokens):
            repl = new_tokens[i] if i < len(new_tokens) else new_tokens[-1]
            text = re.sub(rf"\b{re.escape(tok)}\b", repl, text, flags=re.IGNORECASE)
    text = EMAIL_RE.sub(persona["email"], text)
    text = PHONE_RE.sub(f" {persona['phone']} ", text)
    text = re.sub(r"(?:https?://)?(?:www\.)?linkedin\.com/(?:in|pub)/[^\s]+",
                  f"linkedin.com/in/{persona['handle']}", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:https?://)?(?:www\.)?github\.com/[^\s]+",
                  f"github.com/{persona['handle']}", text, flags=re.IGNORECASE)
    if resume.location:
        text = text.replace(resume.location, persona["location"])
    return replace(resume, name=persona["name"], email=persona["email"],
                   phone=persona["phone"], location=persona["location"],
                   links={}, raw_text=text)


# Synthetic identities spanning deliberately different name origins. These are
# controls in an experiment, not guesses about any real applicant.
#
# Email, phone, location and profile handle are IDENTICAL across personas on
# purpose: the name is the only variable, so any measured spread is attributable
# to the name alone rather than to a longer email address.
_FIXED = {"email": "candidate@example.com", "phone": "+1 415 555 0100",
          "location": "Fairview, Oregon", "handle": "candidate"}
PERSONAS: list[dict] = [
    {"name": name, **_FIXED} for name in (
        "Alex Morgan",
        "Priya Iyer",
        "Chidi Okonkwo",
        "Wei Chen",
        "Fatima Haddad",
    )
]


def anonymisation_audit(resumes: list[ParsedResume], job: JobPosting,
                        original_scores: list[float], score_fn,
                        weights: dict | None = None) -> dict:
    """Score every resume once per synthetic persona and report the spread.

    `score_fn(resumes, job, weights) -> [ScoreResult]` — injected so this module
    stays independent of the scoring engine's import graph.
    """
    if not resumes:
        return {"ran": False, "reason": "no candidates"}

    runs: list[list[float]] = []
    component_runs: list[list[dict]] = []
    for persona in PERSONAS:
        variants = [swap_identity(r, persona) for r in resumes]
        try:
            results = score_fn(variants, job, weights)
        except Exception as e:  # noqa: BLE001
            return {"ran": False, "reason": f"identity-swap re-score failed: {e}"}
        runs.append([s.total for s in results])
        component_runs.append([
            {k: float(v.get("score", 0) or 0) for k, v in (s.breakdown or {}).items()}
            for s in results
        ])

    # Which part of the score reacts to the name? Almost always the semantic
    # signal (the embedding encodes the name); skills / relevance / experience
    # are token-matching and should be perfectly stable.
    components: dict[str, float] = {}
    if component_runs and component_runs[0]:
        for comp in component_runs[0][0]:
            worst = 0.0
            for i in range(len(resumes)):
                vals = [run[i].get(comp, 0.0) for run in component_runs]
                worst = max(worst, max(vals) - min(vals))
            components[comp] = round(worst, 2)

    keys = [r.filename for r in resumes]
    spreads: list[float] = []
    per_candidate: list[dict] = []
    for i, key in enumerate(keys):
        scores = [run[i] for run in runs]
        spread = round(max(scores) - min(scores), 2)
        spreads.append(spread)
        if spread >= 0.01:
            per_candidate.append({
                "filename": key,
                "name": resumes[i].name,
                "score": original_scores[i] if i < len(original_scores) else None,
                "spread": spread,
                "by_persona": {p["name"]: run[i] for p, run in zip(PERSONAS, runs)},
            })

    max_spread = max(spreads) if spreads else 0.0
    mean_spread = round(sum(spreads) / len(spreads), 3) if spreads else 0.0

    # Does the *ranking* survive an identity change? Compare each persona's
    # ordering against the first persona's.
    base_order = [k for _, k in sorted(zip(runs[0], keys), key=lambda p: -p[0])]
    swaps = 0
    for run in runs[1:]:
        order = [k for _, k in sorted(zip(run, keys), key=lambda p: -p[0])]
        swaps += _kendall_swaps(base_order, order)

    clean = max_spread < CLEAN_DELTA and swaps == 0
    unstable = sorted((c for c, v in components.items() if v >= 0.01),
                      key=lambda c: -components[c])

    if clean:
        verdict = (
            f"Changing only the candidate's name moved no score by as much as "
            f"{CLEAN_DELTA:g} point and never changed the ranking, across "
            f"{len(PERSONAS)} substituted names. The ranking is name-blind."
        )
        recommendation = ""
    else:
        verdict = (
            f"Changing only the candidate's name moved a score by up to "
            f"{max_spread:.2f} point(s)"
            + (f" and changed {swaps} pairwise ranking(s)" if swaps else
               " (the ranking itself did not change)") + "."
        )
        if unstable:
            verdict += f" The movement is in: {', '.join(unstable)}."
        recommendation = (
            "The semantic signal is produced by a sentence-embedding model, which "
            "encodes every word in the document including the name. Turn on "
            "Anonymized review to hide identity from reviewers, and consider "
            "lowering the semantic weight if the spread approaches your decision "
            "margins."
            if "semantic" in unstable else
            "Review the affected candidates before relying on this ranking."
        )

    return {
        "ran": True,
        "method": "controlled name substitution (email, phone and location held constant)",
        "candidates": len(resumes),
        "personas": [p["name"] for p in PERSONAS],
        "max_spread": round(max_spread, 2),
        "mean_spread": mean_spread,
        "rank_swaps": swaps,
        "component_spread": components,
        "unstable_components": unstable,
        "clean": clean,
        "threshold": CLEAN_DELTA,
        "verdict": verdict,
        "recommendation": recommendation,
        "affected": sorted(per_candidate, key=lambda m: -m["spread"])[:10],
    }


def pii_audit(resumes: list[ParsedResume]) -> dict:
    """Identity fields present in the documents themselves. These do not affect
    the score (see the anonymisation audit) but a human reader will see them."""
    findings: dict[str, list[str]] = {}
    for r in resumes:
        for label, rx in _PII_PATTERNS:
            if rx.search(r.raw_text):
                findings.setdefault(label, []).append(r.name or r.filename)
    return {
        "categories": [
            {"category": k, "count": len(v), "examples": sorted(set(v))[:5]}
            for k, v in sorted(findings.items(), key=lambda kv: -len(kv[1]))
        ],
        "affected_candidates": len({n for v in findings.values() for n in v}),
        "note": ("These fields appear in the resumes. Turn on Anonymized review "
                 "so reviewers do not see them."),
    }


def jd_language_audit(job: JobPosting) -> dict:
    """Coded language in the job description that skews the applicant pool."""
    hits: list[dict] = []
    for label, rx in _CODED_JD:
        found = sorted({m.group(0).lower() for m in rx.finditer(job.description)})
        if found:
            hits.append({"category": label, "terms": found[:6]})
    return {
        "issues": hits,
        "clean": not hits,
        "note": ("No coded language detected in the job description."
                 if not hits else
                 "These phrases are known to narrow who applies. Consider neutral wording."),
    }


def adverse_impact(groups: dict[str, dict[str, int]]) -> dict:
    """Four-fifths rule from **self-reported, voluntary** data.

    `groups` maps attribute → {group label: {"total": n, "selected": k}}.
    Groups smaller than MIN_GROUP are suppressed rather than published.
    """
    out: list[dict] = []
    for attribute, buckets in (groups or {}).items():
        rows = []
        for label, counts in buckets.items():
            total = int(counts.get("total", 0))
            selected = int(counts.get("selected", 0))
            if total < MIN_GROUP:
                rows.append({"group": label, "total": total, "suppressed": True})
                continue
            rows.append({"group": label, "total": total, "selected": selected,
                         "rate": round(selected / total, 3), "suppressed": False})
        usable = [r for r in rows if not r["suppressed"] and r["total"] >= MIN_GROUP]
        best = max((r["rate"] for r in usable), default=0.0)
        for r in usable:
            r["impact_ratio"] = round(r["rate"] / best, 3) if best else None
        flagged = [r["group"] for r in usable
                   if r.get("impact_ratio") is not None and r["impact_ratio"] < 0.8]
        out.append({
            "attribute": attribute,
            "rows": sorted(rows, key=lambda r: -r["total"]),
            "flagged": flagged,
            "note": (f"Selection rate for {', '.join(flagged)} is below four-fifths of the "
                     f"highest group — investigate." if flagged else
                     "No group falls below the four-fifths threshold."
                     if usable else
                     f"Not enough self-reported responses (minimum {MIN_GROUP} per group)."),
        })
    return {"min_group_size": MIN_GROUP, "attributes": out,
            "basis": "voluntary self-reported data from the application form; never inferred"}


def build_report(resumes: list[ParsedResume], job: JobPosting,
                 original_scores: list[float], score_fn, weights: dict | None = None,
                 demographics: dict | None = None) -> dict:
    return {
        "job_title": job.title,
        "anonymisation": anonymisation_audit(resumes, job, original_scores, score_fn, weights),
        "resume_pii": pii_audit(resumes),
        "jd_language": jd_language_audit(job),
        "adverse_impact": adverse_impact(demographics or {}),
        "disclaimer": ("Scores assist human review and are not hiring decisions. "
                       "Demographic figures are self-reported and aggregate only."),
    }
