"""OCR fallback for scanned / photographed resumes.

A large share of real applications arrive as phone photos or scans with no text
layer at all — `pdfplumber` returns an empty string and the document used to be
rejected outright, silently losing the candidate.

Deliberately dependency-light for hosted deployments:
  • `pypdfium2`             rasterises PDF pages — pure pip wheel, no poppler
  • `rapidocr-onnxruntime`  ONNX OCR — pure pip, no tesseract binary, offline
    (onnxruntime is already present as a fastembed dependency)

Both imports are lazy and optional: if either is missing, `available()` is False
and callers fall back to their existing "no extractable text" behaviour.
"""
from __future__ import annotations

import io
import logging
import threading

from app.config import OCR_DPI, OCR_ENABLED, OCR_MAX_PAGES

log = logging.getLogger("talentlens.ocr")

_lock = threading.Lock()
_engine = None
_state: str | None = None  # None = untried, "ready", or an error message


def _load() -> object | None:
    """Import and construct the OCR engine once. Never raises."""
    global _engine, _state
    if _state is not None:
        return _engine
    with _lock:
        if _state is not None:
            return _engine
        if not OCR_ENABLED:
            _state = "disabled by OCR_ENABLED=0"
            return None
        try:
            import pypdfium2  # noqa: F401
        except Exception as e:  # noqa: BLE001
            _state = f"pypdfium2 unavailable ({e})"
            log.info("OCR disabled: %s", _state)
            return None
        try:
            from rapidocr_onnxruntime import RapidOCR

            _engine = RapidOCR()
            _state = "ready"
            log.info("OCR engine ready")
        except Exception as e:  # noqa: BLE001
            _state = f"rapidocr unavailable ({e})"
            log.info("OCR disabled: %s", _state)
        return _engine


def available() -> bool:
    return _load() is not None


def status() -> str:
    _load()
    return _state or "untried"


def _lines_from_result(result) -> list[str]:
    """RapidOCR returns (detections, elapsed); each detection is [box, text, score]."""
    if not result:
        return []
    dets = result[0] if isinstance(result, tuple) else result
    if not dets:
        return []
    rows: list[tuple[float, float, str]] = []
    for det in dets:
        try:
            box, text = det[0], det[1]
            if not text or not str(text).strip():
                continue
            ys = [float(p[1]) for p in box]
            xs = [float(p[0]) for p in box]
            rows.append((sum(ys) / len(ys), min(xs), str(text).strip()))
        except Exception:  # noqa: BLE001, PERF203  (skip malformed detections)
            continue
    if not rows:
        return []
    # Group detections into visual lines, then order left-to-right within each.
    rows.sort(key=lambda r: (r[0], r[1]))
    lines: list[str] = []
    current: list[tuple[float, float, str]] = [rows[0]]
    tolerance = 12.0
    for r in rows[1:]:
        if abs(r[0] - current[-1][0]) <= tolerance:
            current.append(r)
        else:
            current.sort(key=lambda x: x[1])
            lines.append(" ".join(c[2] for c in current))
            current = [r]
    current.sort(key=lambda x: x[1])
    lines.append(" ".join(c[2] for c in current))
    return lines


def pdf_to_text(data: bytes, max_pages: int | None = None) -> str:
    """OCR the first N pages of a PDF. Returns "" when OCR isn't available."""
    engine = _load()
    if engine is None:
        return ""
    import numpy as np
    import pypdfium2 as pdfium

    limit = max_pages or OCR_MAX_PAGES
    scale = max(0.5, OCR_DPI / 72.0)
    out: list[str] = []
    doc = None
    try:
        doc = pdfium.PdfDocument(io.BytesIO(data))
        for i in range(min(len(doc), limit)):
            try:
                page = doc[i]
                bitmap = page.render(scale=scale, grayscale=False)
                arr = np.asarray(bitmap.to_pil().convert("RGB"))
                lines = _lines_from_result(engine(arr))
                if lines:
                    out.append("\n".join(lines))
            except Exception as e:  # noqa: BLE001
                log.debug("OCR failed on page %s: %s", i, e)
    except Exception as e:  # noqa: BLE001
        log.info("OCR could not open PDF: %s", e)
        return ""
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:  # noqa: BLE001
                pass
    return "\n".join(out).strip()


def image_to_text(data: bytes) -> str:
    """OCR a standalone image file (jpg/png). Returns "" when unavailable."""
    engine = _load()
    if engine is None:
        return ""
    try:
        import numpy as np
        from PIL import Image

        img = Image.open(io.BytesIO(data)).convert("RGB")
        return "\n".join(_lines_from_result(engine(np.asarray(img)))).strip()
    except Exception as e:  # noqa: BLE001
        log.info("OCR could not read image: %s", e)
        return ""
