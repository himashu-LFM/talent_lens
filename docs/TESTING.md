# TalentLens — End-to-End Test Plan

Purpose: verify the whole product works as a recruiter would use it — from sign-up to a
ranked, reviewed, exported shortlist — including Gmail automation, accuracy behaviour,
persistence, and failure handling.

Legend: **P0** = must pass before anyone relies on it · **P1** = should pass before wider
rollout · **P2** = nice to have.

---

## 1. Environment & prerequisites

| Item | Requirement |
|---|---|
| Backend | `cd backend && venv\Scripts\activate && pip install -r requirements.txt && python run.py` → `http://127.0.0.1:8000/api/ready` returns `semantic_model: "ready"` (first run downloads ~130 MB model) |
| Frontend | `cd frontend && npm install && npm run dev` → `http://localhost:5173` |
| Supabase | `frontend/.env` has real `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`; **`supabase/schema.sql` executed** in SQL Editor (tables: `profiles`, `screening_runs`, `jobs`, `candidate_reviews`) |
| Gmail | `backend/credentials.json` present (Desktop OAuth client); test Gmail account you control |
| Browsers | Chrome (primary), Edge, one mobile viewport (375 px) |
| Test accounts | **User A** and **User B** (two different emails) — needed for data-isolation tests |
| Ports free | 8000 and 5173 (only one backend instance running — see §9 "10055" note) |

Reset between full passes: delete `backend/data/watches.json` and `backend/data/auto_results.json`; clear test rows in Supabase if needed.

---

## 2. Test data set (build once, reuse)

Create a folder `test-data/` with:

| File | Purpose | Expected behaviour |
|---|---|---|
| `strong.pdf` | Resume matching **all** JD must-haves, 5+ yrs via date ranges ("Jan 2018 – Present") | Ranks #1, score ≥ 75, all must-haves matched |
| `partial.pdf` | Classical-ML profile missing the LLM/RAG/prompt/API must-haves | Ranks in the lower half; each missing must-have listed under "What would raise this score" with points |
| `weak.docx` | Unrelated profile (e.g. sales) with 1–2 incidental keyword hits | Score < 40 |
| `alt-a.pdf` / `alt-b.pdf` | One lists **TensorFlow** only, the other **PyTorch** only | Both satisfy a JD line "TensorFlow or PyTorch" (neither penalised) |
| `student.pdf` | Education date ranges (e.g. "B.Tech 2022 – 2026") plus one internship "May 2025 – Aug 2025" | Experience ≈ 0.3y (education **not** counted) |
| `typo.txt` | Skills with typos ("Pyhton", "Kubernets") | Still matched (fuzzy) |
| `notresume.pdf` | A letter/form/ID card PDF | **Flagged "not a resume"**, excluded from ranking |
| `dup1.pdf` + `dup2.pdf` | Identical content, different filenames | Second reported "Duplicate — skipped" |
| `same-person.pdf` | Same email as `strong.pdf`, different text | "possible duplicate" badge |
| `scanned.pdf` | Image-only PDF | Error "No extractable text" (not a crash) |
| `big.pdf` | > 15 MB | Rejected with 413 message |
| `bad.exe` renamed `.pdf` | Corrupt file | Error entry, batch still completes |

JDs:
- **JD-GOOD**: title + 80–150 words, "3+ years", 5–7 skills, uses "must have", "a plus", and one "X or Y".
- **JD-BAD**: "We need a rockstar ninja developer who is young and energetic." (no title)
- **JD-NONTECH**: e.g. Marketing Manager — SEO, Salesforce, Excel, "campaign management", "content strategy".

Gmail: a label **`QA-Applications`** containing 3 emails with resume attachments (PDF, DOCX, and one with two attachments), 1 email with a non-resume attachment, 1 email with no attachment. Mark them all **unread**.

---

## 3. Test cases

### 3.1 Landing, auth & navigation (P0)

| ID | Steps | Expected |
|---|---|---|
| AUTH-01 | Open `/` while signed out | Landing page; nav shows Sign in / Get started; no console errors |
| AUTH-02 | Click **Get started** | `/login?mode=up` with **Create account** tab pre-selected |
| AUTH-03 | Create account (User A) | Success toast; either redirected to dashboard or "check your email" (depending on Supabase confirm setting); `profiles` row created with full name |
| AUTH-04 | Sign out → sign in with wrong password | Error toast with Supabase message; stays on login |
| AUTH-05 | Sign in correctly | Dashboard, "Welcome back, {first name}" |
| AUTH-06 | Visit `/history` signed out | Redirected to `/login` |
| AUTH-07 | Signed in, visit `/login` | Redirected to `/` |
| AUTH-08 | Visit `/nonexistent` | "Page not found" state inside app layout |
| NAV-01 | Click each nav item | Correct page, active pill animates, URL updates, page transition plays |
| NAV-02 | Resize to 375 px | Hamburger menu appears; nav links work; no horizontal page scroll |
| NAV-03 | Toggle theme (sun/moon) | Whole app switches; persists after reload; all text readable in **both** themes (check gold buttons, inputs, tags) |
| NAV-04 | Avatar menu → Profile / Settings / Sign out | Each works |

### 3.2 Job description & analyzer (P0)

| ID | Steps | Expected |
|---|---|---|
| JD-01 | Paste **JD-GOOD**, click **Analyze JD** | Grade A/B, requirements count matches skills listed, years detected |
| JD-02 | Paste **JD-BAD**, Analyze | Grade D; issues: no title, short, no skills, vague buzzwords, biased wording |
| JD-03 | Edit JD after analysis | Report disappears until re-analyzed |
| JD-04 | Save job (signed in) → reload → pick from **Saved jobs** | Title, description, top-N and weights restored; **Update job** label shown |
| JD-05 | Delete saved job | Removed from dropdown, toast confirms |
| JD-06 | Shortlist size: slider and number input | Both stay in sync; number accepts > 50 |
| JD-07 | Screen with empty JD | Error toast "Add a job description first", no request sent |

### 3.3 Upload screening — accuracy (P0)

Use JD-GOOD unless stated.

| ID | Steps | Expected |
|---|---|---|
| SCR-01 | Upload all resumes from §2, click Screen | Overlay shows 4 steps then closes; toast "Ranked N — showing top M"; results scroll into view |
| SCR-02 | Check ranking order | `strong` is #1; `alt-a` and `alt-b` both in the top 3 (within ~10 pts of each other); `weak` is last; `partial` and `student` in the lower half; `notresume` never appears in the table |
| SCR-03 | Expand `strong` | Breakdown bars sum to total; all must-haves under Matched; evidence snippets shown for matched skills |
| SCR-04 | Expand `partial` | Missing must-haves listed with **+points** in "What would raise this score"; must-have badge on them |
| SCR-05 | `alt-a` and `alt-b` | Requirements panel shows a dashed tag "tensorflow or pytorch"; both candidates have it under Matched (not Missing) |
| SCR-06 | `student` | Experience ≈ 0.3y (not 4y — education dates excluded); brief headline names the internship company |
| SCR-07 | `typo.txt` | Misspelled skills still matched |
| SCR-08 | `notresume.pdf` | Appears in **"Excluded — didn't look like a resume"** with confidence % and reasons; **not** in the table; info toast about exclusion |
| SCR-09 | `dup2.pdf` | Listed under errors as duplicate; only one copy ranked |
| SCR-10 | `same-person.pdf` | Red **possible duplicate** badge on both rows |
| SCR-11 | `scanned.pdf`, corrupt file | Each listed in errors; other files still ranked |
| SCR-12 | `big.pdf` | Request rejected with clear 413 toast |
| SCR-13 | JD with **no** taxonomy skills (JD-NONTECH) | Requirements still detected via generic extraction (dashed tags); ranking sensible |
| SCR-14 | Weights: Tune → Semantic 0, others up → screen | Breakdown has **no semantic** row; totals still ≤ 100 |
| SCR-15 | Screen 100+ resumes (duplicate a set) | Completes < 60 s; UI responsive; no negative scores anywhere |
| SCR-16 | Stop backend, click Screen | Error toast (not a white screen); app usable after backend returns |

### 3.4 Results workspace (P0/P1)

| ID | Steps | Expected |
|---|---|---|
| RES-01 | Search by name, email, skill | Table filters live; "No candidates match" when nothing |
| RES-02 | Status filter, sort by score/experience/name, min-score slider | Each applied correctly; counts in status dropdown update |
| RES-03 | Change a candidate's **status** (signed in, history on) | Toast; row style updates; **persists after reload** (from History → View) |
| RES-04 | Type **notes**, blur | "Notes saved" toast; persists after reload |
| RES-05 | Same as RES-03 but with Supabase not configured | Local change + info toast "enable history to save" |
| RES-06 | Select 2–3 → **Compare** | Side-by-side modal: scores, breakdown bars, matched/missing, brief; Close works |
| RES-07 | Select 4 → Compare | Button disabled (max 3) |
| RES-08 | **Anonymize** | Names become "Candidate #n"; Email/Phone columns hidden; export still contains names (only view is anonymized) |
| RES-09 | **Select all filtered → Shortlist selected** | All rows shortlisted; counts update; persisted |
| RES-10 | **Shortlist everyone ≥ 70 → Apply** | Only `new` candidates ≥ 70 change |
| RES-11 | **Heatmap** view | Columns = requirements; ● where matched; coverage % row; low-coverage columns red |
| RES-12 | **Pipeline** view — drag a card New → Interview | Card moves; status persisted; counts update |
| RES-13 | Keyboard: `j`/`k`, `s`, `r`, `i`, `e`, `a` | Row highlight moves; statuses set; row expands; anonymize toggles; **none fire while typing in an input** |
| RES-14 | **View resume** (upload run, PDF) | Inline PDF viewer opens; Close works; for Gmail/history runs button absent |
| RES-15 | **Export Excel** | File `shortlist_<title>.xlsx`; header row, title row, columns incl. **Status** and **Notes**; rows = currently filtered candidates |
| RES-16 | **Print** | Print preview hides nav/toolbar/notes; table readable in black on white |
| RES-17 | Copy interview questions | Clipboard contains numbered questions |
| RES-18 | Long names/emails/filenames (60+ chars) | Truncated with ellipsis; **nothing overflows** any card/table at 1280 px and 375 px |

### 3.5 Gmail (P0)

| ID | Steps | Expected |
|---|---|---|
| GM-01 | Settings with no `credentials.json` | "Not configured" notice; Connect disabled |
| GM-02 | **Connect Gmail** | Google consent opens; after approval status shows Connected + account email; labels load |
| GM-03 | Dashboard → From Gmail → label picker: type part of a label name | Filters; groups "Your labels" / "Gmail system"; Enter selects; ✓ on selected |
| GM-04 | **Create label** "QA-New-Label" | Appears in Gmail; auto-selected; toast |
| GM-05 | Create same label again | No error; existing label returned |
| GM-06 | Select `QA-Applications`, **Unread only ON**, **Mark read ON** → Screen | Fetches 3 resume emails (4 attachments); non-resume flagged; no-attachment email ignored; emails now **read** in Gmail; source shown under each candidate (subject · sender) |
| GM-07 | Screen again, Unread only ON | Info toast "No unread emails…" |
| GM-08 | Unread only **OFF** | Fetches all again |
| GM-09 | Mark read **OFF** → screen unread | Emails stay unread |
| GM-10 | **Auto-screen this label → Turn on** (interval 2 min) | Toast; Settings lists the watch (enabled, interval, 0 runs) |
| GM-11 | Send a new resume email to the label; wait ≤ 3 min | Dashboard banner "1 new auto-screened batch"; nav badge count; **Review** loads results; **Save to history** creates a run with source "Auto"; **Dismiss** acks |
| GM-12 | Settings → watch **Run now** | Toast with fetched count; last-run time updates |
| GM-13 | Disable watch → wait | No new results; enable again → resumes |
| GM-14 | Delete watch | Removed |
| GM-15 | **Email candidate** before granting send scope | 403 toast telling you to reconnect |
| GM-16 | Settings → **Reconnect to enable sending** → approve | "Send emails" permission shows ●; Email candidate → template picker → Send | Recipient receives the mail from the connected account |
| GM-17 | Disconnect | Status Not connected; dashboard Gmail button disabled |

### 3.6 History, Talent pool, Analytics, Profile, Settings (P1)

| ID | Steps | Expected |
|---|---|---|
| HIS-01 | After 3 runs (upload, gmail, auto) | Cards show source tag, date, metrics, top candidate; newest first |
| HIS-02 | **View** | Modal with full results incl. saved statuses/notes; changes persist |
| HIS-03 | **Export** from card | Excel with that run's shortlist |
| HIS-04 | **Delete** | Card removed; its reviews deleted (Supabase cascade) |
| HIS-05 | Open `/history?run=<id>` | That run's modal auto-opens |
| TP-01 | Talent pool | One card per unique person (same email across runs merged); best score + role; skills union; run chips link to `/history?run=` |
| TP-02 | Filter by skill / min experience / min score / text | Correct subset |
| AN-01 | Analytics | KPIs count up; charts render; hover tooltips; **Show as tables** swaps every chart for a table |
| AN-02 | Funnel reflects statuses set in RES-03/09/12 | Numbers match |
| PROF-01 | Edit name + company → Save → reload | Persisted; avatar initials update |
| SET-01 | Add custom skill "ListenFirst Platform" aliases "LF platform" → screen a resume containing "LF platform" | Skill appears as matched; removing the skill stops matching |
| SET-02 | Theme Dark/Light in Settings | Matches header toggle; persists |

### 3.7 Data isolation & security (P0)

| ID | Steps | Expected |
|---|---|---|
| SEC-01 | User A creates runs/jobs/notes; sign in as **User B** | B sees **none** of A's history, talent pool, jobs, analytics |
| SEC-02 | With B's session, call Supabase REST for `screening_runs` with A's run id | Empty result (RLS) |
| SEC-03 | Upload `.exe`/`.zip` | 400 unsupported type |
| SEC-04 | 31+ screening requests in one minute from one IP (script) | 429 "Too many screening requests" |
| SEC-05 | Backend logs | Every request has a request id + duration; no PII (resume text) logged |
| SEC-06 | `backend/credentials.json`, `token.json`, `frontend/.env` | Not committed (`git status` clean of them) |

### 3.8 API contract (P1, run with curl/Postman)

| ID | Call | Expected |
|---|---|---|
| API-01 | `GET /api/health` | `{"status":"ok","version":"3.0.0"}` |
| API-02 | `GET /api/ready` | model status, gmail flags, limits, default weights, watch counts |
| API-03 | `POST /api/screen` with 3 files + `weights` JSON | 200; `ranked` sorted desc; every `score` in [0,100]; `job.alternative_groups`, `extra_requirements`, `weights` present; each candidate has `evidence`, `improvements`, `brief`, `interview_questions` |
| API-04 | `POST /api/screen` without `description` | 400 |
| API-05 | `POST /api/jd/analyze` | `score`, `grade`, `issues[]` |
| API-06 | `POST /api/export` with `status`/`notes` | xlsx download; `Content-Disposition` filename from title |
| API-07 | `POST /api/skills/custom` → `GET /api/skills` → `DELETE` | Round-trips |
| API-08 | `POST /api/watches` … `PATCH` … `POST /{id}/run` … `DELETE` | Round-trips; `results?unacked=true` lists new results |

### 3.9 Non-functional (P1/P2)

| ID | Check | Target |
|---|---|---|
| NF-01 | First screening after backend start (model warm-up) | < 15 s; subsequent 10-resume screens < 5 s |
| NF-02 | 300 resumes in one request | Completes; UI table still usable (filters, sort) |
| NF-03 | Lighthouse (desktop) on dashboard | Performance ≥ 85, Accessibility ≥ 90 |
| NF-04 | Keyboard-only navigation | All controls reachable; focus ring visible |
| NF-05 | 375 px viewport, every page | No horizontal scroll; tables scroll inside their container |
| NF-06 | Backend restarted while UI open | Next action shows error toast, then recovers; no white screen |
| NF-07 | Reduced-motion OS setting | Animations effectively disabled |

---

## 4. Acceptance / exit criteria

- 100 % of **P0** cases pass; no open P0/P1 defects.
- ≥ 95 % of **P1** pass; remaining P1 have tickets.
- Accuracy sanity: on the §2 data set, ranking order in SCR-02 holds; `notresume.pdf` is never ranked; no negative or > 100 score ever appears.
- Two-user isolation (SEC-01/02) passes.
- Zero console errors on any page in a clean load (ignore external font/Supabase DNS failures on offline machines).

---

## 5. Bug report template

```
Title: [Area] one-line summary
Severity: P0 / P1 / P2
Environment: browser + version, theme (dark/light), viewport, backend version (/api/health)
Steps:
  1.
  2.
Expected:
Actual:
Attachments: screenshot, console errors, request id from X-Request-ID header, backend log lines
Test data used: file names / JD id / Gmail label
```

---

## 6. Smoke checklist (5 minutes, run after every deploy)

1. `/api/ready` → `semantic_model: ready`
2. Sign in → dashboard loads, no console errors
3. Upload `strong.pdf` + `notresume.pdf` with JD-GOOD → strong ranked, notresume flagged
4. Set a status + note → reload → still there
5. Export Excel opens
6. Gmail: labels load; screen `QA-Applications` (Unread only off) returns candidates
7. Toggle theme both ways
