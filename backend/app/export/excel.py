"""Export ranked top candidates to an Excel workbook."""
from __future__ import annotations

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEADERS = ["Rank", "Name", "Email", "Phone", "Experience (yrs)",
           "Score", "Matched Skills", "Missing Skills"]


def build_excel(candidates: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Top Candidates"

    header_fill = PatternFill("solid", fgColor="4F46E5")
    header_font = Font(bold=True, color="FFFFFF")
    for col, head in enumerate(HEADERS, start=1):
        cell = ws.cell(row=1, column=col, value=head)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for i, c in enumerate(candidates, start=1):
        ws.cell(row=i + 1, column=1, value=i)
        ws.cell(row=i + 1, column=2, value=c.get("name", ""))
        ws.cell(row=i + 1, column=3, value=c.get("email", ""))
        ws.cell(row=i + 1, column=4, value=c.get("phone", ""))
        ws.cell(row=i + 1, column=5, value=c.get("experience_years", 0))
        ws.cell(row=i + 1, column=6, value=c.get("score", 0))
        ws.cell(row=i + 1, column=7, value=", ".join(c.get("matched_skills", [])))
        ws.cell(row=i + 1, column=8, value=", ".join(c.get("missing_skills", [])))

    widths = [6, 24, 30, 20, 16, 8, 40, 40]
    for col, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(col)].width = w
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
