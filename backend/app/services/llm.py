"""Optional LLM deep-dive over the top-N shortlist.

The offline hybrid engine ranks everybody. This adds a second, slower opinion on
just the finalists — the part of the job where judgement beats keyword coverage.
Off entirely unless `ANTHROPIC_API_KEY` is set.

Cost control:
  • only the top N candidates are sent (default 25, never the whole batch)
  • the job description and rubric go in a cached system prompt, so every
    candidate after the first reads them at the cache rate
  • one request per candidate, run concurrently
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import (ANTHROPIC_API_KEY, LLM_MAX_CANDIDATES, LLM_MODEL,
                        LLM_RESUME_CHARS, llm_configured)

log = logging.getLogger("talentlens.llm")

_SYSTEM = """You are an experienced technical recruiter assessing candidates against one job description.

Rules:
- Judge only on evidence in the resume. Never infer or comment on the candidate's gender, age, ethnicity, nationality, religion, marital status, or any protected characteristic, and never let them influence the verdict.
- Reward demonstrated depth (what they built, owned, and measured) over keyword presence.
- A missing must-have is a real gap; say so plainly rather than hedging.
- Be concise and concrete. No praise language, no filler.
- Your assessment assists a human reviewer. It is not a hiring decision.

Always answer by calling the `assess_candidate` tool exactly once."""

_TOOL = {
    "name": "assess_candidate",
    "description": "Record a structured assessment of one candidate against the role.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "verdict": {
                "type": "string",
                "enum": ["strong_yes", "yes", "maybe", "no"],
                "description": "Overall recommendation for advancing this candidate.",
            },
            "fit_score": {
                "type": "integer",
                "minimum": 0, "maximum": 100,
                "description": "Independent 0-100 fit judgement, ignoring the offline score.",
            },
            "summary": {
                "type": "string",
                "description": "Two sentences on why this candidate does or does not fit.",
            },
            "strengths": {
                "type": "array", "items": {"type": "string"},
                "description": "Up to 4 specific, evidence-backed strengths for this role.",
            },
            "concerns": {
                "type": "array", "items": {"type": "string"},
                "description": "Up to 4 specific gaps or risks, each tied to a requirement.",
            },
            "evidence": {
                "type": "array", "items": {"type": "string"},
                "description": "Up to 3 short quotes from the resume supporting the verdict.",
            },
            "questions": {
                "type": "array", "items": {"type": "string"},
                "description": "Up to 3 interview questions that would resolve the concerns.",
            },
            "seniority": {
                "type": "string",
                "enum": ["intern", "junior", "mid", "senior", "lead", "principal", "executive"],
                "description": "Seniority the resume actually demonstrates.",
            },
        },
        "required": ["verdict", "fit_score", "summary", "strengths", "concerns",
                     "evidence", "questions", "seniority"],
    },
}


def available() -> bool:
    if not llm_configured():
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def status() -> str:
    if not llm_configured():
        return "no ANTHROPIC_API_KEY set"
    try:
        import anthropic  # noqa: F401
    except Exception as e:  # noqa: BLE001
        return f"anthropic package unavailable ({e})"
    return "ready"


def _client():
    from anthropic import Anthropic

    return Anthropic(api_key=ANTHROPIC_API_KEY)


def _assess_one(client, title: str, description: str, cand: dict) -> dict:
    resume_text = (cand.get("resume_text") or "")[:LLM_RESUME_CHARS]
    offline = cand.get("score")
    missing = ", ".join(cand.get("missing_skills") or []) or "none detected"
    matched = ", ".join(cand.get("matched_skills") or []) or "none detected"

    resp = client.messages.create(
        model=LLM_MODEL,
        max_tokens=2000,
        system=[
            {"type": "text", "text": _SYSTEM},
            # The JD and rubric are identical for every candidate in the batch,
            # so cache them: candidate 2..N read this prefix at the cache rate.
            {
                "type": "text",
                "text": (f"JOB TITLE\n{title}\n\nJOB DESCRIPTION\n{description}"),
                "cache_control": {"type": "ephemeral"},
            },
        ],
        tools=[_TOOL],
        messages=[{
            "role": "user",
            "content": (
                f"Offline engine scored this candidate {offline}/100.\n"
                f"Requirements it matched: {matched}\n"
                f"Requirements it did not find: {missing}\n\n"
                f"RESUME\n{resume_text}\n\n"
                "Assess this candidate against the job description above."
            ),
        }],
    )

    if getattr(resp, "stop_reason", None) == "refusal":
        return {"error": "The model declined to assess this document."}

    for block in resp.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "assess_candidate":
            data = block.input
            if isinstance(data, str):
                data = json.loads(data)
            usage = getattr(resp, "usage", None)
            return {
                **data,
                "model": LLM_MODEL,
                "usage": {
                    "input_tokens": getattr(usage, "input_tokens", 0) if usage else 0,
                    "output_tokens": getattr(usage, "output_tokens", 0) if usage else 0,
                    "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) if usage else 0,
                },
            }
    return {"error": "No assessment returned."}


def deep_dive(title: str, description: str, candidates: list[dict],
              top_n: int | None = None, max_workers: int = 4) -> dict:
    """Assess up to `top_n` candidates. Each candidate dict needs
    `filename`, `resume_text`, and optionally score/matched/missing.

    Returns {"ran": bool, "assessments": {filename: {...}}, "usage": {...}}.
    """
    if not available():
        return {"ran": False, "reason": status(), "assessments": {}}

    limit = min(top_n or LLM_MAX_CANDIDATES, LLM_MAX_CANDIDATES)
    batch = candidates[:limit]
    if not batch:
        return {"ran": False, "reason": "no candidates", "assessments": {}}

    client = _client()
    out: dict[str, dict] = {}
    totals = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}

    # The first call writes the cache; running it alone first means the rest read
    # the cached prefix instead of each writing their own copy.
    first = batch[0]
    try:
        out[first["filename"]] = _assess_one(client, title, description, first)
    except Exception as e:  # noqa: BLE001
        log.warning("LLM assess failed for %s: %s", first.get("filename"), e)
        out[first["filename"]] = {"error": str(e)[:200]}

    rest = batch[1:]
    if rest:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(_assess_one, client, title, description, c): c["filename"]
                for c in rest
            }
            for fut in as_completed(futures):
                fname = futures[fut]
                try:
                    out[fname] = fut.result()
                except Exception as e:  # noqa: BLE001
                    log.warning("LLM assess failed for %s: %s", fname, e)
                    out[fname] = {"error": str(e)[:200]}

    for a in out.values():
        u = a.get("usage") or {}
        for k in totals:
            totals[k] += int(u.get(k, 0) or 0)

    return {"ran": True, "model": LLM_MODEL, "assessed": len(out),
            "assessments": out, "usage": totals}
