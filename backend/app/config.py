"""Runtime configuration, overridable via environment variables."""
from __future__ import annotations

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# Local data dir (custom skills, auto-screen watches & results)
DATA_DIR: str = os.getenv(
    "DATA_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"),
)
os.makedirs(DATA_DIR, exist_ok=True)

# Auto-screen watcher tick (seconds)
WATCHER_TICK_SECONDS: int = _int("WATCHER_TICK_SECONDS", 60)

# CORS: comma-separated origins. "*" for local dev.
CORS_ORIGINS: list[str] = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()
]

# Upload guards
MAX_FILES_PER_REQUEST: int = _int("MAX_FILES_PER_REQUEST", 300)
MAX_FILE_MB: int = _int("MAX_FILE_MB", 15)
ALLOWED_EXTENSIONS: tuple[str, ...] = (".pdf", ".docx", ".txt")

# Simple per-IP rate limit for the heavy screening endpoints
RATE_LIMIT_PER_MINUTE: int = _int("RATE_LIMIT_PER_MINUTE", 30)

# Documents below this "looks like a resume" confidence are flagged, not ranked
RESUME_CONFIDENCE_MIN: float = float(os.getenv("RESUME_CONFIDENCE_MIN", "0.35"))

# Scoring shares (must sum to 100). Overridable per request.
DEFAULT_WEIGHTS: dict[str, int] = {
    "semantic": _int("W_SEMANTIC", 40),
    "skills": _int("W_SKILLS", 30),
    "relevance": _int("W_RELEVANCE", 15),
    "experience": _int("W_EXPERIENCE", 15),
}
