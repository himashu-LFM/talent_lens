"""Hybrid, offline resume↔JD scoring — LLM-like relevance with no API key.

Signals combined per candidate:
  • semantic   — local embeddings; JD vs. the best-matching chunks of the resume
  • skills     — weighted coverage of requirements (taxonomy must-have / nice-to-have
                 + JD-extracted), with "A or B" alternative groups, hard-gated on
                 must-haves
  • relevance  — BM25 lexical relevance (small-batch fallback), clamped to [0, 1]
  • experience — years (explicit or date-inferred) vs. requirement / baseline

Also produced per candidate: evidence snippets, "what would raise this score",
a 3-line brief, interview questions, and near-duplicate grouping.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from rank_bm25 import BM25Okapi
from rapidfuzz import fuzz
from rapidfuzz.distance import DamerauLevenshtein, Levenshtein

from app.config import DEFAULT_WEIGHTS
from app.parsing.resume_parser import ParsedResume, _RANGE_RE
from app.scoring import embedding
from app.scoring.engine import JobPosting
from app.scoring.skills import SKILL_ALIASES, canonical_skills_in, contains_term

_TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9+#.\-]{1,}")
_MONTHS_L = {"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
             "january", "february", "march", "april", "june", "july", "august", "september",
             "october", "november", "december", "present", "current"}
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")
_PREF_CUES = (
    "plus", "preferred", "nice to have", "nice-to-have", "bonus", "a plus",
    "desirable", "good to have", "would be a plus", "ideally", "optional",
)
_REQ_CUES = re.compile(
    r"(?:experience (?:with|in|of)|proficien(?:t|cy) (?:in|with)|knowledge of|"
    r"familiar(?:ity)? with|expertise in|skilled in|hands[- ]on (?:with|in)|"
    r"background in|working with|must have|should have|strong in|"
    r"understanding of|exposure to|ability to use)\s+([^.;\n]{3,160})",
    re.IGNORECASE,
)
_GENERIC_STOP = {
    "the", "and", "or", "a", "an", "of", "in", "with", "to", "for", "on", "at",
    "is", "are", "be", "as", "by", "from", "this", "that", "our", "your", "you",
    "we", "will", "can", "team", "role", "work", "working", "strong", "good",
    "excellent", "experience", "years", "year", "skills", "skill", "ability",
    "knowledge", "etc", "including", "such", "like", "e.g", "eg", "i.e", "ie",
    "tools", "technologies", "frameworks", "languages", "concepts", "related",
    "various", "other", "similar", "environment", "platforms", "systems",
    "development", "software", "engineer", "engineering", "candidate", "plus",
    "preferred", "required", "requirements", "responsibilities", "least",
    "minimum", "hands", "on", "using", "use", "build", "building",
    # people / org words that follow "working with" but aren't skills
    "product", "products", "teams", "stakeholders", "engineers", "designers",
    "customers", "clients", "colleagues", "management", "leadership", "business",
    "users", "partners", "vendors", "peers", "cross-functional", "cross", "functional",
    "data teams", "product teams", "sales", "marketing", "founders", "executives",
    "data", "team members", "people", "others", "organization", "company",
}


@dataclass
class ScoreResult:
    total: float
    breakdown: dict
    matched_skills: list[str]
    missing_skills: list[str]
    evidence: dict[str, str] = field(default_factory=dict)
    semantic_snippet: str = ""
    improvements: list[dict] = field(default_factory=list)
    brief: dict = field(default_factory=dict)
    questions: list[str] = field(default_factory=list)
    duplicate_group: str | None = None


# --------------------------------------------------------------------------
# text helpers
# --------------------------------------------------------------------------
def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text)]


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT_SPLIT.split(text) if s and s.strip()]


def _chunks(text: str, target: int = 450) -> list[str]:
    out: list[str] = []
    buf = ""
    for s in _sentences(text):
        if len(buf) + len(s) + 1 > target and buf:
            out.append(buf)
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf:
        out.append(buf)
    return out or [text[:target]]


_EMAIL_SUB = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_PHONE_SUB = re.compile(r"(?:(?:\+|00)\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,4}\d{2,4}")
_PROFILE_SUB = re.compile(
    r"(?:https?://)?(?:www\.)?(?:linkedin\.com/(?:in|pub)|github\.com)/[A-Za-z0-9\-_.%]+",
    re.IGNORECASE,
)


def _deidentify(chunk: str, resume: ParsedResume) -> str:
    """Replace the candidate's identity with fixed placeholders of the same shape.

    Used only for the text handed to the embedding model, so the semantic score
    reflects professional content rather than whose name is on the page. Token
    count is preserved so document-length effects don't shift instead.
    """
    out = chunk
    for tok in re.split(r"[^A-Za-z]+", resume.name or ""):
        if len(tok) >= 3:
            out = re.sub(rf"\b{re.escape(tok)}\b", "Candidate", out, flags=re.IGNORECASE)
    out = _EMAIL_SUB.sub("candidate@example.com", out)
    out = _PHONE_SUB.sub(" 0000000000 ", out)
    out = _PROFILE_SUB.sub("profile/candidate", out)
    if resume.location:
        out = out.replace(resume.location, "Location")
    return out


def _snippet_for(term: str, text: str) -> str:
    for s in _sentences(text):
        if contains_term(s, term):
            return s[:180]
    return ""


def _present(term: str, text: str, tokens: set[str]) -> tuple[bool, str]:
    if contains_term(text, term):
        return True, _snippet_for(term, text)
    if " " not in term and len(term) >= 4:
        # Typo tolerance: for terms of 6+ chars accept a single edit including a
        # transposition ("pyhton", "kubernets"); shorter terms stay strict.
        for tok in tokens:
            if abs(len(tok) - len(term)) > 2:
                continue
            if fuzz.ratio(tok, term) >= 90:
                return True, _snippet_for(tok, text)
            if len(term) >= 6 and DamerauLevenshtein.distance(tok, term) == 1:
                # Accept a dropped/extra letter ("kubernets") or an adjacent swap
                # ("pyhton"), but NOT a single substitution — that turns real words
                # into skills ("locker" → docker).
                if len(tok) != len(term) or Levenshtein.distance(tok, term) == 2:
                    return True, _snippet_for(tok, text)
    elif " " in term and len(term) >= 8:
        for s in _sentences(text):
            if fuzz.partial_ratio(term, s.lower()) >= 92:
                return True, s[:180]
    return False, ""


def _skill_present(skill: str, text: str, tokens: set[str]) -> tuple[bool, str]:
    for alias in SKILL_ALIASES.get(skill, [skill]):
        ok, ev = _present(alias, text, tokens)
        if ok:
            return True, ev
    return False, ""


# --------------------------------------------------------------------------
# JD understanding
# --------------------------------------------------------------------------
def _preferred_skills(job: JobPosting) -> set[str]:
    prefs: set[str] = set()
    for sentence in re.split(r"[.\n;•]", job.description.lower()):
        if any(cue in sentence for cue in _PREF_CUES):
            prefs |= canonical_skills_in(sentence)
    return prefs


def alternative_groups(job: JobPosting) -> list[frozenset[str]]:
    """Skills the JD lists as alternatives ("TensorFlow or PyTorch", "AWS/GCP")."""
    groups: list[frozenset[str]] = []
    for sentence in re.split(r"[.\n;•]", job.description.lower()):
        for seg in re.split(r",|\band\b|\bwith\b|\(|\)", sentence):
            if " or " in seg or "/" in seg:
                found = canonical_skills_in(seg)
                if len(found) >= 2:
                    g = frozenset(found)
                    if g not in groups:
                        groups.append(g)
    # keep groups disjoint (first wins)
    seen: set[str] = set()
    out: list[frozenset[str]] = []
    for g in groups:
        g2 = frozenset(s for s in g if s not in seen)
        if len(g2) >= 2:
            out.append(g2)
            seen |= g2
    return out


def extract_generic_requirements(job: JobPosting) -> list[str]:
    known_aliases = {a for als in SKILL_ALIASES.values() for a in als}
    jd_low = job.description.lower()
    found: list[str] = []
    for m in _REQ_CUES.finditer(job.description):
        tail = m.group(1)
        tail = re.split(r"\b(?:and|or)?\s*(?:is|are|to|for|that|which|who|as)\b", tail)[0]
        for part in re.split(r",|/|\band\b|\bor\b|&|\|", tail):
            p = re.sub(r"[^a-zA-Z0-9+#. \-]", " ", part).strip(" .-").lower()
            p = re.sub(r"\s+", " ", p)
            if not (2 <= len(p) <= 40):
                continue
            words = p.split()
            while words and words[0] in _GENERIC_STOP:
                words.pop(0)
            while words and words[-1] in _GENERIC_STOP:
                words.pop()
            if not words or len(words) > 4 or all(w in _GENERIC_STOP for w in words):
                continue
            p = " ".join(words)
            if p in known_aliases or canonical_skills_in(p):
                continue
            if any(p != a and p in a and a in jd_low for a in known_aliases):
                continue
            if p not in found:
                found.append(p)
    return found[:20]


def _job_query_terms(job: JobPosting, extra: list[str]) -> list[str]:
    terms = list(job.title_keywords)
    for skill in job.required_skills:
        terms.extend(SKILL_ALIASES.get(skill, [skill]))
    terms.extend(extra)
    terms.extend(sorted(job.keywords))
    out: list[str] = []
    for t in terms:
        out.extend(_tokens(t))
    return out


def normalise_weights(weights: dict | None) -> dict[str, int]:
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        for k in w:
            if k in weights:
                try:
                    w[k] = max(0, int(weights[k]))
                except (TypeError, ValueError):
                    pass
    total = sum(w.values()) or 1
    scaled = {k: round(v * 100 / total) for k, v in w.items()}
    diff = 100 - sum(scaled.values())
    if diff:
        scaled[max(scaled, key=scaled.get)] += diff
    return scaled


# --------------------------------------------------------------------------
# per-candidate extras
# --------------------------------------------------------------------------
def _brief(r: ParsedResume, matched: list[str], missing_must: list[str],
           req_years: float) -> dict:
    from app.parsing.resume_parser import _EDU_WORDS

    _ROLE = re.compile(r"\b(engineer|developer|analyst|manager|designer|scientist|consultant|"
                       r"intern|lead|architect|specialist|associate|executive|head|director)\b", re.I)
    headline = ""
    lines = [ln.strip() for ln in r.raw_text.splitlines()]
    candidates: list[str] = []
    for i, ln in enumerate(lines):
        if not ln or not _RANGE_RE.search(ln) or _EDU_WORDS.search(ln) or len(ln) > 160:
            continue
        # A date-only line ("May 2025 – Aug 2025") carries no role: pair it with
        # the nearest non-empty line above, which usually names the role/company.
        words = [w for w in re.findall(r"[A-Za-z]{3,}", ln) if w.lower() not in _MONTHS_L]
        if len(words) < 2:
            j = i - 1
            while j >= 0 and not lines[j]:
                j -= 1
            if j >= 0 and not _EDU_WORDS.search(lines[j]) and len(lines[j]) <= 120:
                ln = f"{lines[j]} · {ln}"
        candidates.append(re.sub(r"\s+", " ", ln))
    for s in candidates:
        if _ROLE.search(s):
            headline = s
            break
    if not headline and candidates:
        headline = candidates[0]
    if not headline:
        for s in _sentences(r.raw_text)[:6]:
            if any(k in s.lower() for k in ("engineer", "developer", "analyst", "manager",
                                            "designer", "scientist", "consultant", "intern")):
                headline = s[:160]
                break
    exp = f"{r.experience_years:g} yrs experience" if r.experience_years else "experience not stated"
    if req_years:
        exp += f" (role asks {req_years:g})"
    return {
        "headline": headline or "Profile summary unavailable",
        "experience": exp,
        "strengths": matched[:4],
        "gaps": missing_must[:3],
    }


def _questions(r: ParsedResume, matched: list[str], missing_must: list[str],
               evidence: dict[str, str], req_years: float, title: str) -> list[str]:
    qs: list[str] = []
    for s in missing_must[:2]:
        qs.append(f"The role needs {s}. Have you worked with it or something adjacent? "
                  f"How would you get productive with it quickly?")
    for s in matched[:3]:
        ev = evidence.get(s, "")
        hint = f" (you mention: “{ev[:90]}…”)" if ev else ""
        qs.append(f"Walk me through the most complex thing you've built or solved using {s}{hint}. "
                  f"What was your specific contribution?")
    if req_years and r.experience_years < req_years:
        qs.append(f"This role asks for about {req_years:g} years; your resume suggests ~{r.experience_years:g}. "
                  f"Where has your experience been deepest, and how do you close the gap?")
    elif r.experience_years:
        qs.append(f"Describe a project where your {r.experience_years:g} years of experience directly changed the outcome.")
    qs.append(f"What about this {title or 'role'} attracts you, and what would you want to own in your first 90 days?")
    return qs[:7]


def _duplicate_groups(resumes: list[ParsedResume], mean_vecs: list[list[float] | None]) -> list[str | None]:
    """Group near-duplicate people by email / phone / name, or ≥0.97 text similarity."""
    n = len(resumes)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        parent[find(a)] = find(b)

    def norm_name(s: str) -> str:
        return re.sub(r"[^a-z]", "", s.lower())

    by_email: dict[str, int] = {}
    by_phone: dict[str, int] = {}
    by_name: dict[str, int] = {}
    for i, r in enumerate(resumes):
        if r.email:
            k = r.email.lower()
            if k in by_email:
                union(i, by_email[k])
            by_email.setdefault(k, i)
        digits = re.sub(r"\D", "", r.phone or "")[-10:]
        if len(digits) >= 9:
            if digits in by_phone:
                union(i, by_phone[digits])
            by_phone.setdefault(digits, i)
        nm = norm_name(r.name)
        if len(nm) >= 6:
            if nm in by_name:
                union(i, by_name[nm])
            by_name.setdefault(nm, i)
    for i in range(n):
        vi = mean_vecs[i]
        if not vi:
            continue
        for j in range(i + 1, n):
            vj = mean_vecs[j]
            if vj and embedding.cosine(vi, vj) >= 0.97:
                union(i, j)

    roots = [find(i) for i in range(n)]
    counts: dict[int, int] = {}
    for rt in roots:
        counts[rt] = counts.get(rt, 0) + 1
    labels: dict[int, str] = {}
    out: list[str | None] = []
    for rt in roots:
        if counts[rt] > 1:
            labels.setdefault(rt, f"dup-{len(labels) + 1}")
            out.append(labels[rt])
        else:
            out.append(None)
    return out


# --------------------------------------------------------------------------
# main entry
# --------------------------------------------------------------------------
def score_batch(
    resumes: list[ParsedResume],
    job: JobPosting,
    weights: dict | None = None,
) -> list[ScoreResult]:
    if not resumes:
        return []

    shares = normalise_weights(weights)
    req = job.required_skills
    pref = _preferred_skills(job) & req
    must = req - pref
    groups = alternative_groups(job)
    grouped: set[str] = set().union(*groups) if groups else set()
    singles = sorted(req - grouped)
    extra_reqs = extract_generic_requirements(job)
    req_years = job.required_years
    base_years = req_years if req_years > 0 else 5.0

    # ---- lexical relevance ----
    corpus_tokens = [_tokens(r.raw_text) for r in resumes]
    query = _job_query_terms(job, extra_reqs)
    q_unique = list(dict.fromkeys(t for t in query if t not in _GENERIC_STOP))
    if len(resumes) >= 4 and any(corpus_tokens) and query:
        raw_bm = BM25Okapi(corpus_tokens).get_scores(query)
        bm_scores = [max(0.0, float(s)) for s in raw_bm]
    else:
        bm_scores = []
        for toks in corpus_tokens:
            ts = set(toks)
            hit = sum(1 for t in q_unique if t in ts)
            bm_scores.append(hit / len(q_unique) if q_unique else 0.0)
    bm_max = max(bm_scores) if bm_scores and max(bm_scores) > 0 else 1.0

    # ---- chunked semantic ----
    use_sem = embedding.available() and shares.get("semantic", 0) > 0
    sem_scores = [0.0] * len(resumes)
    sem_snips = [""] * len(resumes)
    mean_vecs: list[list[float] | None] = [None] * len(resumes)
    if use_sem:
        job_text = f"{job.title}. {job.description}"
        all_chunks: list[str] = []      # de-identified — what the model sees
        shown_chunks: list[str] = []    # original text — what the recruiter sees
        owner: list[int] = []
        for i, r in enumerate(resumes):
            raw = r.raw_text[:12000]
            # The embedding encodes every word, including the candidate's name, so
            # scoring the raw text makes the semantic signal name-sensitive (the
            # fairness audit measures exactly this). De-identify *before* chunking:
            # doing it afterwards leaves chunk boundaries dependent on how many
            # characters the person's name happens to have.
            cs = _chunks(_deidentify(raw, r))
            shown = _chunks(raw)
            all_chunks.extend(cs)
            shown_chunks.extend(
                shown[k] if k < len(shown) else cs[k] for k in range(len(cs))
            )
            owner.extend([i] * len(cs))
        vecs = embedding.embed([job_text] + all_chunks)
        if vecs:
            jv = vecs[0]
            per: dict[int, list[tuple[float, str]]] = {}
            acc: dict[int, list[list[float]]] = {}
            for ci, rv in enumerate(vecs[1:]):
                o = owner[ci]
                per.setdefault(o, []).append((embedding.cosine(jv, rv), shown_chunks[ci]))
                acc.setdefault(o, []).append(rv)
            for i, lst in per.items():
                lst.sort(key=lambda x: x[0], reverse=True)
                top = [c for c, _ in lst[:3]]
                cos = 0.6 * top[0] + 0.4 * (sum(top) / len(top))
                sem_scores[i] = max(0.0, min((cos - 0.47) / 0.33, 1.0))
                sem_snips[i] = lst[0][1][:200]
            for i, vs in acc.items():
                dim = len(vs[0])
                mean_vecs[i] = [sum(v[d] for v in vs) / len(vs) for d in range(dim)]
        else:
            use_sem = False

    if not use_sem:
        s = shares.get("semantic", 0)
        shares = {k: v for k, v in shares.items() if k != "semantic"}
        if s and shares:
            add = s / len(shares)
            shares = {k: round(v + add) for k, v in shares.items()}

    dup_labels = _duplicate_groups(resumes, mean_vecs)

    def w_of(s: str) -> float:
        return 0.4 if s in pref else 1.0

    results: list[ScoreResult] = []
    for i, r in enumerate(resumes):
        text = r.raw_text
        toks = set(_tokens(text))
        evidence: dict[str, str] = {}

        present: dict[str, bool] = {}
        for s in sorted(req):
            ok, ev = _skill_present(s, text, toks)
            present[s] = ok
            if ok and ev:
                evidence[s] = ev

        # requirement units: singles + alternative groups + generic extras
        matched: list[str] = []
        missing: list[str] = []
        total_w = 0.0
        got_w = 0.0
        must_units = 0
        must_got = 0
        unit_weights: dict[str, tuple[float, bool]] = {}  # display -> (weight, is_must)

        for s in singles:
            wt = w_of(s)
            total_w += wt
            is_must = s in must
            unit_weights[s] = (wt, is_must)
            if is_must:
                must_units += 1
            if present[s]:
                got_w += wt
                matched.append(s)
                if is_must:
                    must_got += 1
            else:
                missing.append(s)

        for g in groups:
            members = sorted(g)
            wt = max(w_of(s) for s in members)
            is_must = any(s in must for s in members)
            label = " or ".join(members)
            total_w += wt
            unit_weights[label] = (wt, is_must)
            if is_must:
                must_units += 1
            hits = [s for s in members if present[s]]
            if hits:
                got_w += wt
                matched.extend(hits)
                if is_must:
                    must_got += 1
            else:
                missing.append(label)

        for t in extra_reqs:
            ok, ev = _present(t, text, toks)
            total_w += 0.7
            unit_weights[t] = (0.7, False)
            if ok:
                got_w += 0.7
                matched.append(t)
                if ev:
                    evidence[t] = ev
            else:
                missing.append(t)

        coverage = (got_w / total_w) if total_w else 1.0
        gate = (0.4 + 0.6 * (must_got / must_units)) if must_units else 1.0
        skills01 = coverage * gate
        exp01 = min(r.experience_years / base_years, 1.0)
        bm01 = max(0.0, min(bm_scores[i] / bm_max, 1.0)) if bm_max else 0.0

        parts: dict[str, float] = {}
        if use_sem:
            parts["semantic"] = sem_scores[i]
        parts["skills"] = skills01
        parts["relevance"] = bm01
        parts["experience"] = exp01

        breakdown: dict = {}
        total = 0.0
        for k, val in parts.items():
            share = shares.get(k, 0)
            pts = val * share
            total += pts
            entry: dict = {"score": round(pts, 1), "max": share}
            if k == "skills":
                entry.update({
                    "matched": len(matched), "required": len(unit_weights),
                    "must_have": must_units, "must_have_matched": must_got,
                })
            if k == "experience":
                entry.update({"candidate_years": r.experience_years,
                              "required_years": req_years})
            breakdown[k] = entry
        total = max(0.0, min(total, 100.0))

        # ---- what would raise this score ----
        skills_share = shares.get("skills", 0)
        improvements: list[dict] = []
        for label in missing:
            wt, is_must = unit_weights.get(label, (0.7, False))
            new_cov = (got_w + wt) / total_w if total_w else 1.0
            new_gate = (0.4 + 0.6 * ((must_got + (1 if is_must else 0)) / must_units)) if must_units else 1.0
            gain = (new_cov * new_gate - skills01) * skills_share
            improvements.append({"requirement": label, "points": round(gain, 1),
                                 "must_have": is_must})
        if req_years and r.experience_years < req_years:
            gain = (1.0 - exp01) * shares.get("experience", 0)
            improvements.append({"requirement": f"{req_years:g}+ years experience",
                                 "points": round(gain, 1), "must_have": False})
        improvements.sort(key=lambda x: x["points"], reverse=True)

        missing_must = [m for m in missing if unit_weights.get(m, (0, False))[1]]
        brief = _brief(r, matched, missing_must, req_years)
        questions = _questions(r, matched, missing_must, evidence, req_years, job.title)

        results.append(ScoreResult(
            round(total, 1), breakdown, matched, missing, evidence, sem_snips[i],
            improvements[:6], brief, questions, dup_labels[i],
        ))
    return results
