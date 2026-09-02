"""Build docs/TalentLens_TestCases.xlsx — the executable test-case workbook that
mirrors docs/TESTING.md (test cases, smoke checklist, bug log, live summary).

Usage: backend\\venv\\Scripts\\python.exe scripts\\make_test_workbook.py
"""
from __future__ import annotations

import os

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "TalentLens_TestCases.xlsx")

GOLD = "F5C518"
INK = "111111"
thin = Side(style="thin", color="D9D9D9")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

# (ID, Area, Priority, Title, Preconditions, Steps, Expected)
CASES: list[tuple[str, str, str, str, str, str, str]] = [
    # ---- Auth & nav
    ("AUTH-01", "Auth & Nav", "P0", "Landing page for visitors", "Signed out", "Open /", "Landing page with Sign in / Get started; no console errors"),
    ("AUTH-02", "Auth & Nav", "P0", "Get started deep-links to sign-up", "Signed out", "Click Get started", "/login?mode=up with Create account tab selected"),
    ("AUTH-03", "Auth & Nav", "P0", "Create account", "Supabase configured", "Fill name, email, password; submit", "Success toast; dashboard or 'check your email'; profiles row created with full name"),
    ("AUTH-04", "Auth & Nav", "P0", "Wrong password", "Account exists", "Sign in with wrong password", "Error toast with message; stays on login"),
    ("AUTH-05", "Auth & Nav", "P0", "Sign in", "Account exists", "Sign in correctly", "Dashboard shows 'Welcome back, <first name>'"),
    ("AUTH-06", "Auth & Nav", "P0", "Protected route redirect", "Signed out", "Open /history", "Redirected to /login"),
    ("AUTH-07", "Auth & Nav", "P1", "Login redirect when signed in", "Signed in", "Open /login", "Redirected to /"),
    ("AUTH-08", "Auth & Nav", "P1", "404 page", "Signed in", "Open /nonexistent", "'Page not found' inside app layout with link home"),
    ("NAV-01", "Auth & Nav", "P0", "Primary navigation", "Signed in", "Click each nav item", "Correct page; active pill animates; URL updates; transition plays"),
    ("NAV-02", "Auth & Nav", "P1", "Mobile navigation", "Signed in", "Resize to 375px; open hamburger; navigate", "Menu works; no horizontal page scroll"),
    ("NAV-03", "Auth & Nav", "P1", "Theme toggle", "Signed in", "Toggle sun/moon; reload; check gold buttons, inputs, tags in both themes", "Theme switches and persists; all text readable"),
    ("NAV-04", "Auth & Nav", "P1", "User menu", "Signed in", "Avatar → Profile / Settings / Sign out", "Each action works"),
    # ---- JD
    ("JD-01", "Job description", "P0", "Analyze good JD", "JD-GOOD pasted", "Click Analyze JD", "Grade A/B; requirements count matches; years detected"),
    ("JD-02", "Job description", "P0", "Analyze bad JD", "JD-BAD pasted", "Click Analyze JD", "Grade D; issues: no title, short, no skills, buzzwords, biased wording"),
    ("JD-03", "Job description", "P2", "Report clears on edit", "Analysis shown", "Edit the JD text", "Report disappears until re-analyzed"),
    ("JD-04", "Job description", "P1", "Save & load job", "Signed in, history on", "Save job → reload → pick from Saved jobs", "Title, description, top-N, weights restored; button reads 'Update job'"),
    ("JD-05", "Job description", "P1", "Delete saved job", "Saved job selected", "Click delete", "Removed from dropdown; toast"),
    ("JD-06", "Job description", "P2", "Shortlist size controls", "-", "Move slider; type number > 50", "Slider and number stay in sync; >50 accepted"),
    ("JD-07", "Job description", "P0", "Screen with empty JD", "No description", "Click Screen", "Error toast; no request sent"),
    # ---- Screening accuracy
    ("SCR-01", "Screening accuracy", "P0", "Full upload run", "All §2 files, JD-GOOD", "Upload all; Screen", "Overlay shows 4 steps; toast 'Ranked N — showing top M'; results scroll into view"),
    ("SCR-02", "Screening accuracy", "P0", "Ranking order", "SCR-01 done", "Read table order", "strong is #1; alt-a and alt-b both in top 3 (within ~10 pts); weak last; partial & student in lower half; notresume never in table"),
    ("SCR-03", "Screening accuracy", "P0", "Strong candidate detail", "SCR-01", "Expand strong.pdf", "Breakdown sums to total; all must-haves matched; evidence snippets present"),
    ("SCR-04", "Screening accuracy", "P0", "Improvements for partial", "SCR-01", "Expand partial.pdf", "Missing must-haves listed with +points and must-have badge"),
    ("SCR-05", "Screening accuracy", "P0", "'A or B' alternatives", "SCR-01", "Check alt-a and alt-b", "Dashed tag 'pytorch or tensorflow'; both show it under Matched"),
    ("SCR-06", "Screening accuracy", "P0", "Education dates excluded", "SCR-01", "Expand student.pdf", "Experience ≈ 0.3y (not 4y); brief headline names the internship company"),
    ("SCR-07", "Screening accuracy", "P1", "Fuzzy skill matching", "SCR-01", "Expand typo.txt", "Misspelled skills (Pyhton, Kubernets, Tensorflw) matched"),
    ("SCR-08", "Screening accuracy", "P0", "Non-resume excluded", "SCR-01", "Check notresume.pdf", "Listed under 'Excluded — didn't look like a resume' with confidence % and reasons; not in table; info toast"),
    ("SCR-09", "Screening accuracy", "P1", "Exact duplicate skipped", "SCR-01", "Check dup2.pdf", "Error entry 'Duplicate … skipped'; one copy ranked"),
    ("SCR-10", "Screening accuracy", "P1", "Same-person detection", "SCR-01", "Check strong.pdf & same-person.pdf", "Red 'possible duplicate' badge on both rows"),
    ("SCR-11", "Screening accuracy", "P0", "Corrupt & scanned files", "SCR-01", "Check scanned.pdf, bad.pdf", "Each listed in errors; other files still ranked"),
    ("SCR-12", "Screening accuracy", "P1", "Oversize file", "big.pdf", "Upload big.pdf; Screen", "413 toast with clear limit message"),
    ("SCR-13", "Screening accuracy", "P1", "Non-tech JD", "JD-NONTECH", "Screen weak.docx + strong.pdf", "Generic requirements detected (dashed tags); weak.docx ranks above strong.pdf"),
    ("SCR-14", "Screening accuracy", "P1", "Custom weights", "Tune → semantic 0", "Screen", "No semantic row in breakdown; totals ≤ 100"),
    ("SCR-15", "Screening accuracy", "P1", "Large batch", "100+ files", "Screen", "Completes < 60s; UI responsive; no negative scores"),
    ("SCR-16", "Screening accuracy", "P0", "Backend down", "Stop backend", "Click Screen; restart backend; retry", "Error toast (no white screen); works after restart"),
    # ---- Results workspace
    ("RES-01", "Results", "P0", "Search", "Results shown", "Search by name / email / skill", "Live filter; empty state when no match"),
    ("RES-02", "Results", "P0", "Filter & sort", "Results shown", "Status filter, sort options, min-score slider", "Applied correctly; counts update"),
    ("RES-03", "Results", "P0", "Status persists", "History on", "Change status → reload → History → View", "Status retained"),
    ("RES-04", "Results", "P0", "Notes persist", "History on", "Type notes, blur → reload", "'Notes saved' toast; notes retained"),
    ("RES-05", "Results", "P1", "Status without history", "Supabase not configured", "Change status", "Local change + info toast"),
    ("RES-06", "Results", "P1", "Compare 2–3", "Results shown", "Select 3 → Compare", "Side-by-side modal with scores, bars, skills, brief; Close works"),
    ("RES-07", "Results", "P2", "Compare limit", "Results shown", "Select 4", "Compare disabled"),
    ("RES-08", "Results", "P0", "Anonymize", "Results shown", "Toggle Anonymize; export", "Names → 'Candidate #n'; email/phone hidden; export still has names"),
    ("RES-09", "Results", "P1", "Bulk shortlist selected", "History on", "Select all filtered → Shortlist selected", "All shortlisted; persisted"),
    ("RES-10", "Results", "P1", "Shortlist ≥ threshold", "Results shown", "Set 70 → Apply", "Only 'new' candidates ≥ 70 change"),
    ("RES-11", "Results", "P1", "Heatmap", "Results shown", "Switch to Heatmap", "Requirement columns; ● where matched; coverage % row; low coverage red"),
    ("RES-12", "Results", "P1", "Pipeline drag & drop", "History on", "Drag card New → Interview", "Card moves; status persisted; counts update"),
    ("RES-13", "Results", "P1", "Keyboard shortcuts", "Table view", "j/k, s, r, i, e, a; then type in search box", "Shortcuts work; none fire while typing in inputs"),
    ("RES-14", "Results", "P1", "Resume viewer", "Upload run with PDF", "Expand → View resume", "Inline PDF; Close works; absent for Gmail/history runs"),
    ("RES-15", "Results", "P0", "Excel export", "Statuses/notes set", "Export Excel; open file", "shortlist_<title>.xlsx; Status & Notes columns; rows = filtered set"),
    ("RES-16", "Results", "P2", "Print report", "Results shown", "Print → preview", "Nav/toolbar/notes hidden; readable in B/W"),
    ("RES-17", "Results", "P2", "Copy interview questions", "Row expanded", "Click Copy questions; paste", "Numbered questions in clipboard"),
    ("RES-18", "Results", "P0", "No text overflow", "Candidate with 60+ char name/email/filename", "View at 1280px and 375px; all views and cards", "Ellipsis truncation; nothing overflows any container"),
    # ---- Gmail
    ("GM-01", "Gmail", "P1", "Not configured state", "No credentials.json", "Open Settings", "'Not configured' notice; Connect disabled"),
    ("GM-02", "Gmail", "P0", "Connect", "credentials.json present", "Connect Gmail → approve", "Connected + account email; labels load"),
    ("GM-03", "Gmail", "P0", "Label picker search", "Connected", "Type partial label name; Enter", "Filters; grouped Your labels / Gmail system; Enter selects; ✓ shown"),
    ("GM-04", "Gmail", "P1", "Create label", "Connected", "Create 'QA-New-Label'", "Exists in Gmail; auto-selected; toast"),
    ("GM-05", "Gmail", "P2", "Create existing label", "GM-04", "Create same name again", "No error; existing label returned"),
    ("GM-06", "Gmail", "P0", "Screen unread + mark read", "QA-Applications seeded, all unread", "Unread only ON, Mark read ON → Screen", "3 resume emails fetched (4 attachments); non-resume flagged; no-attachment ignored; emails now read; source shown per candidate"),
    ("GM-07", "Gmail", "P0", "No unread left", "After GM-06", "Screen again, Unread only ON", "Info toast 'No unread emails…'"),
    ("GM-08", "Gmail", "P1", "Fetch all", "After GM-06", "Unread only OFF → Screen", "All fetched again"),
    ("GM-09", "Gmail", "P1", "Keep unread", "Fresh unread email", "Mark read OFF → Screen", "Email stays unread"),
    ("GM-10", "Gmail", "P0", "Create auto-screen watch", "Connected, JD filled", "Auto-screen → interval 2 → Turn on", "Toast; Settings lists watch enabled with interval"),
    ("GM-11", "Gmail", "P0", "Auto-screen picks up new email", "GM-10", "Send resume email to label; wait ≤ 3 min", "Banner '1 new auto-screened batch'; nav badge; Review loads results; Save to history → run with source Auto; Dismiss acks"),
    ("GM-12", "Gmail", "P1", "Run watch now", "GM-10", "Settings → Run now", "Toast with fetched count; last-run updates"),
    ("GM-13", "Gmail", "P1", "Disable / enable watch", "GM-10", "Toggle off, wait; toggle on", "No results while off; resumes when on"),
    ("GM-14", "Gmail", "P1", "Delete watch", "GM-10", "Delete", "Removed"),
    ("GM-15", "Gmail", "P1", "Email before send scope", "Connected without send", "Expand candidate → Email candidate → Send", "403 toast asking to reconnect"),
    ("GM-16", "Gmail", "P0", "Grant send scope & email", "GM-15", "Settings → Reconnect to enable sending → approve → Email candidate → Send", "Send permission ●; recipient receives email from connected account"),
    ("GM-17", "Gmail", "P1", "Disconnect", "Connected", "Settings → Disconnect", "Not connected; dashboard Gmail button disabled"),
    # ---- Other pages
    ("HIS-01", "History", "P1", "Run cards", "3 runs (upload/gmail/auto)", "Open History", "Source tag, date, metrics, top candidate; newest first"),
    ("HIS-02", "History", "P0", "View run", "HIS-01", "Click View", "Modal with results incl. saved statuses/notes; edits persist"),
    ("HIS-03", "History", "P1", "Export from card", "HIS-01", "Click Export", "Excel of that run"),
    ("HIS-04", "History", "P1", "Delete run", "HIS-01", "Click delete", "Card removed; reviews cascade-deleted"),
    ("HIS-05", "History", "P2", "Deep link", "HIS-01", "Open /history?run=<id>", "That run's modal opens"),
    ("TP-01", "Talent pool", "P1", "Merged people", "Runs exist", "Open Talent pool", "One card per unique email; best score & role; skills union; run chips link to history"),
    ("TP-02", "Talent pool", "P1", "Filters", "TP-01", "Skill, min experience, min score, text", "Correct subset"),
    ("AN-01", "Analytics", "P1", "Charts", "Runs exist", "Open Analytics; hover bars; toggle Show as tables", "KPIs count up; tooltips; every chart has table view"),
    ("AN-02", "Analytics", "P1", "Funnel matches statuses", "RES-03/09/12 done", "Read funnel", "Numbers match statuses set"),
    ("PROF-01", "Profile", "P1", "Edit profile", "Signed in", "Edit name & company → Save → reload", "Persisted; avatar initials update"),
    ("SET-01", "Settings", "P1", "Custom skill affects matching", "Connected backend", "Add 'ListenFirst Platform' alias 'LF platform'; screen resume containing 'LF platform'; remove skill; screen again", "Matched while present; not matched after removal"),
    ("SET-02", "Settings", "P2", "Theme in Settings", "-", "Choose Dark/Light", "Matches header toggle; persists"),
    # ---- Security
    ("SEC-01", "Security", "P0", "Data isolation (UI)", "User A has data", "Sign in as User B", "B sees none of A's history, talent pool, jobs, analytics"),
    ("SEC-02", "Security", "P0", "Data isolation (RLS)", "B's session token", "Call Supabase REST screening_runs?id=eq.<A run id>", "Empty result"),
    ("SEC-03", "Security", "P1", "File type rejection", "-", "Upload .exe / .zip", "400 unsupported type"),
    ("SEC-04", "Security", "P1", "Rate limit", "Script", "31+ /api/screen calls in 60s", "429 'Too many screening requests'"),
    ("SEC-05", "Security", "P1", "Logs", "Backend log", "Inspect", "Request id + duration per request; no resume text/PII"),
    ("SEC-06", "Security", "P0", "Secrets not committed", "Repo", "git status / git log", "credentials.json, token.json, .env absent"),
    # ---- API
    ("API-01", "API", "P1", "Health", "-", "GET /api/health", "{status:ok, version}"),
    ("API-02", "API", "P1", "Readiness", "-", "GET /api/ready", "model, gmail flags, limits, weights, watch counts"),
    ("API-03", "API", "P0", "Screen contract", "3 files", "POST /api/screen with weights", "ranked sorted desc; scores in [0,100]; alternative_groups, extra_requirements, weights; per-candidate evidence, improvements, brief, interview_questions"),
    ("API-04", "API", "P1", "Validation", "-", "POST /api/screen without description", "400"),
    ("API-05", "API", "P1", "JD analyze", "-", "POST /api/jd/analyze", "score, grade, issues[]"),
    ("API-06", "API", "P1", "Export", "-", "POST /api/export with status/notes", "xlsx; filename from title"),
    ("API-07", "API", "P2", "Skills CRUD", "-", "POST/GET/DELETE /api/skills/custom", "Round-trips"),
    ("API-08", "API", "P2", "Watches CRUD", "Gmail connected", "POST/PATCH/run/DELETE /api/watches; results?unacked=true", "Round-trips"),
    # ---- Non-functional
    ("NF-01", "Non-functional", "P1", "Warm-up & speed", "Fresh backend", "Time first and second 10-resume screen", "< 15s first; < 5s after"),
    ("NF-02", "Non-functional", "P2", "300-resume batch", "300 files", "Screen; use filters", "Completes; table usable"),
    ("NF-03", "Non-functional", "P2", "Lighthouse", "Dashboard", "Run Lighthouse desktop", "Performance ≥ 85; Accessibility ≥ 90"),
    ("NF-04", "Non-functional", "P1", "Keyboard-only", "-", "Tab through all controls", "All reachable; focus ring visible"),
    ("NF-05", "Non-functional", "P1", "Mobile layout", "375px", "Every page", "No horizontal scroll; tables scroll in container"),
    ("NF-06", "Non-functional", "P1", "Backend restart recovery", "UI open", "Restart backend; act", "Error toast then recovery; no white screen"),
    ("NF-07", "Non-functional", "P2", "Reduced motion", "OS setting on", "Load app", "Animations effectively disabled"),
]

SMOKE = [
    "GET /api/ready → semantic_model: ready",
    "Sign in → dashboard loads, no console errors",
    "Upload strong.pdf + notresume.pdf with JD-GOOD → strong ranked, notresume flagged",
    "Set a status + note → reload → still there",
    "Export Excel opens with Status/Notes columns",
    "Gmail: labels load; screen QA-Applications (Unread only off) returns candidates",
    "Toggle theme both ways",
]


def style_header(ws, row: int, ncols: int) -> None:
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = PatternFill("solid", fgColor=INK)
        cell.font = Font(bold=True, color=GOLD)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = BORDER


def main() -> None:
    wb = Workbook()

    # ---------------- Summary
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = "TalentLens — End-to-End Test Summary"
    ws["A1"].font = Font(bold=True, size=15)
    ws["A2"] = "Statuses update live from the Test Cases sheet."
    ws["A2"].font = Font(italic=True, color="666666")
    rows = [("Total cases", '=COUNTA(\'Test Cases\'!A2:A400)'),
            ("Passed", '=COUNTIF(\'Test Cases\'!H2:H400,"Pass")'),
            ("Failed", '=COUNTIF(\'Test Cases\'!H2:H400,"Fail")'),
            ("Blocked", '=COUNTIF(\'Test Cases\'!H2:H400,"Blocked")'),
            ("Not run", '=COUNTA(\'Test Cases\'!A2:A400)-COUNTIF(\'Test Cases\'!H2:H400,"Pass")-COUNTIF(\'Test Cases\'!H2:H400,"Fail")-COUNTIF(\'Test Cases\'!H2:H400,"Blocked")'),
            ("Pass rate", '=IF(COUNTA(\'Test Cases\'!A2:A400)=0,0,COUNTIF(\'Test Cases\'!H2:H400,"Pass")/COUNTA(\'Test Cases\'!A2:A400))'),
            ("P0 total", '=COUNTIF(\'Test Cases\'!C2:C400,"P0")'),
            ("P0 passed", '=COUNTIFS(\'Test Cases\'!C2:C400,"P0",\'Test Cases\'!H2:H400,"Pass")'),
            ("P0 failed", '=COUNTIFS(\'Test Cases\'!C2:C400,"P0",\'Test Cases\'!H2:H400,"Fail")'),
            ("Release gate (100% P0 pass, 0 P0 fail)", '=IF(AND(B10=B8,B9=0),"GO","NO-GO")')]
    for i, (label, formula) in enumerate(rows, start=4):
        ws.cell(row=i, column=1, value=label).font = Font(bold=True)
        ws.cell(row=i, column=2, value=formula)
    ws["B9"].number_format = "0%"
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["B"].width = 16
    ws.conditional_formatting.add("B13", CellIsRule(operator="equal", formula=['"GO"'], fill=PatternFill("solid", fgColor="C6EFCE")))
    ws.conditional_formatting.add("B13", CellIsRule(operator="equal", formula=['"NO-GO"'], fill=PatternFill("solid", fgColor="FFC7CE")))

    ws["A16"] = "Per-area results"
    ws["A16"].font = Font(bold=True)
    for c, h in enumerate(["Area", "Total", "Pass", "Fail", "Blocked"], start=1):
        ws.cell(row=17, column=c, value=h)
    style_header(ws, 17, 5)
    areas = sorted({c[1] for c in CASES}, key=lambda a: [c[1] for c in CASES].index(a))
    for i, area in enumerate(areas, start=18):
        ws.cell(row=i, column=1, value=area)
        ws.cell(row=i, column=2, value=f'=COUNTIF(\'Test Cases\'!B2:B400,A{i})')
        ws.cell(row=i, column=3, value=f'=COUNTIFS(\'Test Cases\'!B2:B400,A{i},\'Test Cases\'!H2:H400,"Pass")')
        ws.cell(row=i, column=4, value=f'=COUNTIFS(\'Test Cases\'!B2:B400,A{i},\'Test Cases\'!H2:H400,"Fail")')
        ws.cell(row=i, column=5, value=f'=COUNTIFS(\'Test Cases\'!B2:B400,A{i},\'Test Cases\'!H2:H400,"Blocked")')

    # ---------------- Test Cases
    tc = wb.create_sheet("Test Cases")
    headers = ["ID", "Area", "Priority", "Title", "Preconditions", "Steps", "Expected result",
               "Status", "Actual result", "Tester", "Date", "Bug ID", "Notes"]
    widths = [10, 18, 9, 30, 26, 44, 52, 11, 34, 14, 12, 10, 28]
    for c, (h, w) in enumerate(zip(headers, widths), start=1):
        tc.cell(row=1, column=c, value=h)
        tc.column_dimensions[get_column_letter(c)].width = w
    style_header(tc, 1, len(headers))
    for r, case in enumerate(CASES, start=2):
        for c, val in enumerate(case, start=1):
            cell = tc.cell(row=r, column=c, value=val)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDER
        for c in range(len(case) + 1, len(headers) + 1):
            tc.cell(row=r, column=c).border = BORDER
            tc.cell(row=r, column=c).alignment = Alignment(vertical="top", wrap_text=True)
    last = len(CASES) + 1
    dv = DataValidation(type="list", formula1='"Pass,Fail,Blocked,Not run"', allow_blank=True)
    tc.add_data_validation(dv)
    dv.add(f"H2:H{last + 200}")
    pv = DataValidation(type="list", formula1='"P0,P1,P2"', allow_blank=True)
    tc.add_data_validation(pv)
    pv.add(f"C2:C{last + 200}")
    tc.conditional_formatting.add(f"H2:H{last + 200}", CellIsRule(operator="equal", formula=['"Pass"'], fill=PatternFill("solid", fgColor="C6EFCE")))
    tc.conditional_formatting.add(f"H2:H{last + 200}", CellIsRule(operator="equal", formula=['"Fail"'], fill=PatternFill("solid", fgColor="FFC7CE")))
    tc.conditional_formatting.add(f"H2:H{last + 200}", CellIsRule(operator="equal", formula=['"Blocked"'], fill=PatternFill("solid", fgColor="FFEB9C")))
    tc.conditional_formatting.add(f"C2:C{last + 200}", FormulaRule(formula=['$C2="P0"'], font=Font(bold=True, color="9C0006")))
    tc.freeze_panes = "E2"
    tc.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{last}"

    # ---------------- Test Data
    td = wb.create_sheet("Test Data")
    data_rows = [
        ("strong.pdf", "All must-haves, 7+ yrs via date ranges", "Ranks #1; score ≥ 75; all must-haves matched"),
        ("partial.pdf", "Classical ML; missing LLM/RAG/prompt/OpenAI-Claude", "Lower half; missing must-haves with +points"),
        ("weak.docx", "Sales profile, incidental Excel/SQL", "Score < 40"),
        ("alt-a.pdf / alt-b.pdf", "TensorFlow-only vs PyTorch-only", "Both satisfy 'TensorFlow or PyTorch'"),
        ("student.pdf", "Education 2022–2026 + internship May–Aug 2025", "Experience ≈ 0.3y; headline names internship"),
        ("typo.txt", "Pyhton / Kubernets / Tensorflw", "Fuzzy-matched"),
        ("notresume.pdf", "Hostel leaving letter", "Flagged not-a-resume, excluded"),
        ("dup1.pdf + dup2.pdf", "Identical content", "Second reported duplicate"),
        ("same-person.pdf", "Same email as strong.pdf", "'possible duplicate' badge"),
        ("scanned.pdf", "Image-only PDF", "Error: no extractable text"),
        ("big.pdf", "> 15 MB", "413 rejected"),
        ("bad.pdf", "Random bytes", "Error entry; batch completes"),
        ("jd-good.txt / jd-bad.txt / jd-nontech.txt", "JDs", "Grade A/B · D · non-tech requirement extraction"),
        ("Gmail label QA-Applications", "3 resume emails (one with 2 attachments), 1 non-resume, 1 no attachment — all unread", "GM-06 expectations"),
    ]
    for c, h in enumerate(["File / asset", "Contents", "Expected behaviour"], start=1):
        td.cell(row=1, column=c, value=h)
    style_header(td, 1, 3)
    for r, row in enumerate(data_rows, start=2):
        for c, v in enumerate(row, start=1):
            cell = td.cell(row=r, column=c, value=v)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDER
    for col, w in zip("ABC", [34, 52, 46]):
        td.column_dimensions[col].width = w
    td["A18"] = "Generate with: backend\\venv\\Scripts\\python.exe scripts\\make_test_data.py  → ./test-data/"
    td["A18"].font = Font(italic=True, color="666666")

    # ---------------- Smoke
    sm = wb.create_sheet("Smoke (5 min)")
    for c, h in enumerate(["#", "Check", "Status", "Notes"], start=1):
        sm.cell(row=1, column=c, value=h)
    style_header(sm, 1, 4)
    for i, s in enumerate(SMOKE, start=2):
        sm.cell(row=i, column=1, value=i - 1)
        sm.cell(row=i, column=2, value=s)
        for c in range(1, 5):
            sm.cell(row=i, column=c).border = BORDER
    dv2 = DataValidation(type="list", formula1='"Pass,Fail,Blocked"', allow_blank=True)
    sm.add_data_validation(dv2)
    dv2.add(f"C2:C{len(SMOKE) + 1}")
    sm.column_dimensions["B"].width = 80
    sm.column_dimensions["C"].width = 12
    sm.column_dimensions["D"].width = 40

    # ---------------- Bug Log
    bl = wb.create_sheet("Bug Log")
    bh = ["Bug ID", "Test case ID", "Severity", "Title", "Environment (browser/theme/viewport/backend version)",
          "Steps to reproduce", "Expected", "Actual", "Request ID (X-Request-ID)", "Screenshot / log ref", "Status", "Owner", "Fixed in"]
    for c, h in enumerate(bh, start=1):
        bl.cell(row=1, column=c, value=h)
        bl.column_dimensions[get_column_letter(c)].width = [9, 12, 9, 30, 30, 40, 30, 30, 18, 22, 11, 12, 12][c - 1]
    style_header(bl, 1, len(bh))
    sv = DataValidation(type="list", formula1='"P0,P1,P2"', allow_blank=True)
    bl.add_data_validation(sv)
    sv.add("C2:C300")
    stv = DataValidation(type="list", formula1='"Open,In progress,Fixed,Verified,Won\'t fix"', allow_blank=True)
    bl.add_data_validation(stv)
    stv.add("K2:K300")
    bl.freeze_panes = "B2"

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    print(f"Wrote {OUT} — {len(CASES)} test cases, {len(SMOKE)} smoke checks")


if __name__ == "__main__":
    main()
