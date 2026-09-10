"""Runtime configuration, overridable via environment variables."""
from __future__ import annotations

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# Local data dir (custom skills, auto-screen watches & results)
DATA_DIR: str = os.getenv(
    "DATA_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"),
)
os.makedirs(DATA_DIR, exist_ok=True)

# Auto-screen watcher tick (seconds)
WATCHER_TICK_SECONDS: int = _int("WATCHER_TICK_SECONDS", 60)
# Outbound email queue tick (seconds) and retention sweep interval (hours)
MAILER_TICK_SECONDS: int = _int("MAILER_TICK_SECONDS", 60)
RETENTION_TICK_HOURS: int = _int("RETENTION_TICK_HOURS", 12)

# CORS: comma-separated origins. "*" for local dev.
CORS_ORIGINS: list[str] = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()
]

# Public URL of the frontend — used to build apply / status links inside emails.
PUBLIC_APP_URL: str = os.getenv("PUBLIC_APP_URL", "http://localhost:5173").rstrip("/")

# Upload guards
MAX_FILES_PER_REQUEST: int = _int("MAX_FILES_PER_REQUEST", 300)
MAX_FILE_MB: int = _int("MAX_FILE_MB", 15)
ALLOWED_EXTENSIONS: tuple[str, ...] = (".pdf", ".docx", ".txt")

# Simple per-IP rate limit for the heavy screening endpoints
RATE_LIMIT_PER_MINUTE: int = _int("RATE_LIMIT_PER_MINUTE", 30)
# Public application form: much tighter, it is unauthenticated
PUBLIC_RATE_LIMIT_PER_HOUR: int = _int("PUBLIC_RATE_LIMIT_PER_HOUR", 20)

# Documents below this "looks like a resume" confidence are flagged, not ranked
RESUME_CONFIDENCE_MIN: float = float(os.getenv("RESUME_CONFIDENCE_MIN", "0.35"))

# Scoring shares (must sum to 100). Overridable per request.
DEFAULT_WEIGHTS: dict[str, int] = {
    "semantic": _int("W_SEMANTIC", 40),
    "skills": _int("W_SKILLS", 30),
    "relevance": _int("W_RELEVANCE", 15),
    "experience": _int("W_EXPERIENCE", 15),
}

# ---------------------------------------------------------------- OCR
# Scanned / photographed resumes have no text layer. When enabled we rasterise
# the PDF and run a local ONNX OCR model (no system binaries, no network).
OCR_ENABLED: bool = _bool("OCR_ENABLED", True)
OCR_MAX_PAGES: int = _int("OCR_MAX_PAGES", 4)
OCR_DPI: int = _int("OCR_DPI", 200)

# ---------------------------------------------------------------- Supabase (service role)
# Only needed for the candidate-facing flows (public application form, status
# page) and the background workers, which have no signed-in user to act as.
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
RESUME_BUCKET: str = os.getenv("RESUME_BUCKET", "resumes")


def supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


# Guards the destructive/background admin endpoints (retention sweep, queue drain).
ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "")


# ---------------------------------------------------------------- LLM deep-dive
# Optional second pass over the top-N shortlist. Off unless a key is present.
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
LLM_MODEL: str = os.getenv("LLM_MODEL", "claude-sonnet-5")
LLM_MAX_CANDIDATES: int = _int("LLM_MAX_CANDIDATES", 25)
LLM_RESUME_CHARS: int = _int("LLM_RESUME_CHARS", 12000)


def llm_configured() -> bool:
    return bool(ANTHROPIC_API_KEY)
