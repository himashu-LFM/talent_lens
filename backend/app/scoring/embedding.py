"""Local, offline sentence embeddings via fastembed (ONNX, no API key).

The model (~130 MB) downloads once on first use, then runs fully offline. If it
is unavailable (no network on first run, install issue, etc.), the rest of the
scoring pipeline degrades gracefully to lexical + taxonomy signals.
"""
from __future__ import annotations

import math
import threading

_MODEL_NAME = "BAAI/bge-small-en-v1.5"
_lock = threading.Lock()
_model = None
_state = "unloaded"  # unloaded | ready | unavailable


def _load():
    global _model, _state
    if _state != "unloaded":
        return
    with _lock:
        if _state != "unloaded":
            return
        try:
            from fastembed import TextEmbedding

            _model = TextEmbedding(model_name=_MODEL_NAME)
            # warm up so the first real request isn't slow / doesn't fail silently
            list(_model.embed(["warmup"]))
            _state = "ready"
        except Exception:  # noqa: BLE001
            _model = None
            _state = "unavailable"


def available() -> bool:
    _load()
    return _state == "ready"


def embed(texts: list[str]) -> list[list[float]] | None:
    """Return one vector per input text, or None if embeddings are unavailable."""
    _load()
    if _state != "ready" or not texts:
        return None
    try:
        return [list(v) for v in _model.embed(texts)]  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001
        return None


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
