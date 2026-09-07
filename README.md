# TalentLens — AI Resume Screening & Ranking

Production-grade, **fully offline** resume screening for recruiting teams. Paste a job
title + description, add resumes (upload or straight from a **Gmail label**), and get a
transparent, evidence-backed ranked shortlist you can review, compare, annotate, email
and export. No LLM API key required.

- **Frontend:** React + Vite + TypeScript · Supabase auth · history · talent pool · analytics
- **Backend:** Python + FastAPI · hybrid scoring engine (on-device embeddings + BM25 +
  skill taxonomy + must-have gating + date-based experience) · Gmail integration ·
  auto-screen watcher
- **Data:** Supabase (Postgres + row-level security) for runs, jobs, statuses and notes

---

## Features

### Screening accuracy
- **Hybrid scoring** — semantic fit (local `bge-small` embeddings, JD vs. best resume
  chunks), weighted skill coverage with **must-have gating**, BM25 relevance (small-batch
  fallback), experience inferred from **employment date ranges** (education excluded)
- **"A or B" alternatives** — "TensorFlow or PyTorch" counts as one requirement satisfied by either
- **74-skill taxonomy** + synonyms + fuzzy typo matching, **custom skills** you add in Settings,
  and **generic requirement extraction** from the JD for anything outside the taxonomy
- **Evidence snippets** for every match · **"What would raise this score"** (missing
  must-haves with point values) · **3-line candidate brief** · **interview question generator**
- **"Not a resume" detection** — letters, forms and junk are flagged, not ranked
- **Near-duplicate detection** (same person, different files) · exact-duplicate skipping
- **PDF repair** for glued words · corrupt/scanned-file handling
- **JD quality analyzer** — grades your job description and flags vagueness, missing
  must-haves, unrealistic requirement counts and biased wording *before* you screen
- **Per-job scoring weights**, plus **"learns from your decisions"** — suggests weights
  from your own shortlist/reject history

### Sources & automation
- Drag-and-drop upload (PDF/DOCX/TXT, multi-file)
- **Gmail**: connect once (OAuth) · pick or **create labels from the app** · screen unread/all ·
  optional mark-as-read
- **Auto-screen watches** — the backend polls a label every N minutes, screens new
  applications, and surfaces them as a banner on the dashboard

### Workspace
- **App shell** — icon rail (Screen · Shortlist · History · Pool · Insights · Settings), a context
  sidebar that changes per screen (scoring weights while defining a role; filters, pipeline counts
  and requirements on the shortlist; search + top skills in the pool) and a glass header with the
  command palette
- **Screen** — gradient KPI cards, auto-screen banner, describe-the-role and add-resumes cards;
  finishing a run opens the **Shortlist** page, which also re-opens any run from History
- Dark-first slate + amber design system with a full light theme; Inter, Lucide icons

### Review workflow
- **Candidate detail drawer** — click any row (or press ↵) for a split-screen view: animated
  match-score ring, AI brief, score breakdown, "what would raise this score", evidence,
  interview questions, flags, notes, status pills; ← → to move between candidates
- **Command palette** (Ctrl/⌘ K) — jump to any page or action from the keyboard
- Candidate **status pipeline** (New → Shortlisted → Interview → Rejected → Hired) with
  **reviewer notes**, saved per run
- Views: **Table** · **Requirements heatmap** (who covers what, column coverage %) ·
  **Pipeline board** (drag-and-drop by status)
- **Search / filter / sort**, min-score slider, **bulk actions** ("shortlist everyone ≥ 70")
- **Side-by-side compare** (up to 3) · **anonymized review mode** · **re-applicant** badges
- **Email candidates** from the app (acknowledge / invite / decline templates, sent via Gmail)
- **Inline resume viewer** for uploaded PDFs · **printable report** · Excel export with
  statuses and notes · **keyboard shortcuts** (`j/k`, `s`, `r`, `i`, `e`, `a`)
- **Saved job postings** — reuse a JD and its weights across batches

### Insight
- **History** — every run, re-openable with its statuses and notes
- **Talent pool** — search every candidate you've ever screened by skill, experience, score
- **Analytics** — applications per week, score trend, hiring funnel, most-missing skills, sources

### Platform
- Email/password auth · profiles · **light/dark theme**
- Upload guards (type/size/count), per-IP rate limiting, request IDs + timing logs
- `/api/ready` readiness (model, Gmail, limits, watches), error boundary, 404 page
- Docker + compose deployment (embedding model baked into the image)

---

## Scoring

| Signal | Default | What it measures |
|---|:--:|---|
| Semantic fit | 40 | Meaning-level similarity between JD and the best-matching resume chunks |
| Skills coverage | 30 | Requirements present — must-have ×1.0, nice-to-have ×0.4, JD-extracted ×0.7, "A or B" groups; gated on must-haves |
| Keyword relevance | 15 | BM25 (IDF-weighted) relevance of important JD terms |
| Experience | 15 | Years (explicit or from date ranges) vs. requirement |

Weights are tunable per run/job or via `W_*` env vars. **Scores assist human review; they
are not hiring decisions.** Use anonymized mode to reduce bias.

---

## Run locally

Prereqs: Python 3.10+, Node 18+.

**Backend**
```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python run.py            # http://127.0.0.1:8000
```
First run downloads the ~130 MB embedding model once; afterwards fully offline.

**Frontend**
```powershell
cd frontend
npm install
copy .env.example .env   # paste your Supabase URL + anon key
npm run dev              # http://localhost:5173
```

**Supabase** (auth, history, jobs, statuses, notes, talent pool, analytics)
1. Project Settings → API → copy **Project URL** and **anon public** key into `frontend/.env`.
2. SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql) (safe to re-run).
3. Restart `npm run dev`, then create an account on the login page.

Without Supabase keys the app runs open (no login); history-backed features are disabled.

---

## Connecting Gmail

1. Google Cloud Console → project → enable **Gmail API**.
2. OAuth consent screen → External → add yourself as a test user.
3. Credentials → OAuth client ID → **Desktop app** → download JSON → `backend/credentials.json`.
4. Restart the backend; **Settings → Connect Gmail** (or from the dashboard) and approve.
5. Pick/create your applications label and screen — or turn on **Auto-screen**.

Permissions: read attachments + mark-as-read, and (optional) **send** for emailing
candidates. If you connected before sending was added, use **Settings → Reconnect to
enable sending**.

---

## Deploy with Docker

```bash
cp backend/.env.example backend/.env
export VITE_SUPABASE_URL=...  VITE_SUPABASE_ANON_KEY=...
docker compose up --build -d
```
Frontend on `http://localhost` (nginx proxies `/api`), backend on `:8000`. For public
deployments: HTTPS in front, `CORS_ORIGINS` set to your domain, Gmail switched to a
**Web** OAuth client with a published consent screen, and `backend/data` mounted as a
volume (custom skills, watches).

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` · `/api/ready` | liveness · model/Gmail/limits/watch status |
| POST | `/api/screen` | multipart: `title, description, top_n, weights?, files[]` |
| POST | `/api/jd/analyze` | JD quality report |
| GET/POST/DELETE | `/api/skills` · `/api/skills/custom[/{name}]` | taxonomy |
| GET/POST | `/api/gmail/status` `connect` `disconnect` `labels` `labels/create` `screen` `send` | Gmail |
| GET/POST/PATCH/DELETE | `/api/watches[/{id}]` · `/{id}/run` · `/results` · `/results/{id}/ack` | auto-screen |
| POST | `/api/export` | Excel (with status/notes) |

## Project layout

```
backend/app/
  main.py                 routes, rate limit, logging, validation, watcher lifecycle
  config.py               env-driven settings
  parsing/                extractor (PDF/DOCX/TXT + repair), parser (+ confidence, date ranges)
  scoring/                hybrid engine, embeddings, skills taxonomy (+ custom)
  services/               screening, Gmail client, JD analyzer, auto-screen watcher
  export/                 Excel builder
frontend/src/
  pages/                  Login, Dashboard, History, TalentPool, Analytics, Settings, Profile
  components/             Results (table/heatmap/board, compare, email, viewer), GmailPanel, …
  lib/                    supabase client, db helpers (runs, jobs, reviews, weight learning)
supabase/schema.sql       tables + RLS policies
```

## Testing

- **Test plan:** [`docs/TESTING.md`](docs/TESTING.md) — ~100 end-to-end cases (auth, JD analyzer,
  screening accuracy, results workflow, Gmail + auto-screen, history/talent/analytics, security,
  API, non-functional), exit criteria, bug template, 5-minute smoke checklist.
- **Tracking workbook:** [`docs/TalentLens_TestCases.xlsx`](docs/TalentLens_TestCases.xlsx) —
  same cases with Pass/Fail dropdowns, live summary + release gate, smoke sheet, bug log.
  Regenerate with `backend\venv\Scripts\python.exe scripts\make_test_workbook.py`.
- **Test data:** `backend\venv\Scripts\python.exe scripts\make_test_data.py` creates
  `test-data/` (13 resumes covering strong/partial/weak, "A or B" alternatives, student,
  typos, non-resume, duplicates, scanned, oversize, corrupt + 3 JDs).
- Offline engine check: `backend\smoke_test.py`.

## Limitations
- Scanned-image PDFs have no extractable text (OCR not included).
- Gmail runs as a single connected account (Desktop OAuth); team-wide Gmail needs Web OAuth.
- Single-user data model per account — no shared team workspaces yet.
