"""Extract raw text from resume files (PDF, DOCX, TXT, and scanned images)."""
from __future__ import annotations

import io
import re

import pdfplumber
from docx import Document

from app.parsing import ocr


class UnsupportedFileType(Exception):
    pass


IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp")

# A text layer this thin means the PDF is really a scan with a few stray glyphs
# (page numbers, a watermark), so OCR is worth trying.
_MIN_TEXT_WORDS = 40


def extract_text(filename: str, data: bytes) -> str:
    """Return plain text for a resume file given its bytes."""
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return _from_pdf(data)
    if name.endswith(".docx"):
        return _from_docx(data)
    if name.endswith(".txt"):
        return data.decode("utf-8", errors="ignore")
    if name.endswith(IMAGE_EXTS):
        text = ocr.image_to_text(data)
        if text:
            return _clean(text)
        raise UnsupportedFileType(
            f"{filename} is an image and OCR is unavailable on this server."
        )
    raise UnsupportedFileType(f"Unsupported file type: {filename}")


def _glue_ratio(text: str) -> float:
    """Fraction of 'words' that are suspiciously long (spaces lost in extraction)."""
    words = text.split()
    if not words:
        return 0.0
    return sum(1 for w in words if len(w) > 22) / len(words)


def _clean(text: str) -> str:
    """Repair gluing artefacts common to both PDF extraction and OCR output."""
    # Split CamelCase gluing like "PairspracticalGenerativeAIengineering" — but only
    # inside long tokens, so product names (PyTorch, TensorFlow, JavaScript,
    # LangChain, GitHub …) are never broken apart.
    def _split_long(m: re.Match) -> str:
        return re.sub(r"(?<=[a-z])(?=[A-Z][a-z])", " ", m.group(0))

    text = re.sub(r"\S{14,}", _split_long, text)
    text = re.sub(r"\(cid:\d+\)", " ", text)  # pdf glyph artefacts
    return text


def _from_pdf(data: bytes) -> str:
    """Extract PDF text, retrying with tighter spacing tolerance when the
    default extraction glues words together (common with some resume templates),
    then falling back to OCR when there is effectively no text layer."""
    def run(x_tol: float) -> str:
        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text(x_tolerance=x_tol) or "")
        return "\n".join(parts)

    try:
        text = run(3.0)  # pdfplumber default
        if _glue_ratio(text) > 0.06:
            for tol in (1.5, 1.0):
                alt = run(tol)
                if _glue_ratio(alt) < _glue_ratio(text):
                    text = alt
                if _glue_ratio(text) <= 0.03:
                    break
    except Exception:  # noqa: BLE001 — a broken text layer shouldn't block OCR
        text = ""

    if len(text.split()) < _MIN_TEXT_WORDS:
        scanned = ocr.pdf_to_text(data)
        # Keep whichever is richer; a scan with a stray header still OCRs better.
        if len(scanned.split()) > len(text.split()):
            text = scanned

    return _clean(text)


def _from_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)
