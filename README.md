# TalentLens — AI Resume Screening & Ranking

Production-grade, **fully offline** resume screening for recruiting teams. Paste a job
title + description, add resumes (upload or straight from a **Gmail label**), and get a
transparent, evidence-backed ranked shortlist you can review, compare, annotate, email
and export. No LLM API key required.

- **Frontend:** React + Vite + TypeScript · Supabase auth · team workspaces · public
  apply links · candidate status pages · history · talent pool · analytics
- **Backend:** Python + FastAPI · hybrid scoring engine (on-device embeddings + BM25 +
  skill taxonomy + must-have gating + date-based experience) · OCR for scanned resumes ·
  Gmail integration · auto-screen watcher · email queue · retention sweeper
- **Data:** Supabase (Postgres + row-level security + private Storage) for teams, runs,
  jobs, applications, interviews, comments and an append-only audit log

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
- **PDF repair** for glued words · corrupt-file handling
- **OCR fallback** for scanned and photographed resumes — these used to be rejected with
  "no extractable text", silently losing the candidate. Runs locally with no system
  binaries and no network
- **Structured career profile** — employer, title and tenure per role, merged totals,
  employment gaps, job-hopping and seniority signals, education level
- **Optional LLM second opinion** on the shortlist only (Sonnet 5 by default, with the
  job description in a cached prompt prefix). Off unless a server key is set
- **Best-fit across roles** — score one resume against every open job at once
- **JD quality analyzer** — grades your job description and flags vagueness, missing
  must-haves, unrealistic requirement counts and biased wording *before* you screen
- **Per-job scoring weights**, plus **"learns from your decisions"** — suggests weights
  from your own shortlist/reject history

### Team
- **Organizations** with roles — **admin** (everything, plus roster and retention),
  **recruiter** (screen, manage jobs, email), **interviewer** (review and comment only),
  **viewer** (read-only). Row-level security is enforced on org membership, not on the
  individual, so a teammate sees the same shortlists you do
- **Invite by email** — the link only works for the address it was issued to
- **Threaded discussion** and a **candidate owner** on every candidate
- **Resume storage** — the original document is kept in a private bucket (deduped per org
  by content hash), so re-opening a past run still shows the PDF
- **Append-only audit log** — every status and owner change, written by a database
  trigger. The table has no update or delete policy, so nobody can rewrite it, admins
  included

### Candidate-facing
- **Public apply link per job** — a hosted form that parses and scores the application
  the moment it lands, capturing the structured fields no parser can infer reliably
  (location, notice period, expected salary) plus explicit consent
- **Candidate status page** — one private link, no password, showing their stage and
  nothing else: never a score, never another applicant
- **Interview self-scheduling** — offer slots, the candidate books one, and a calendar
  invite goes out. Slot claims are conditional, so two people cannot take the same slot
- **Email queue** with merge fields, stage templates, scheduled sends and retry backoff
- **Auto-acknowledgement** on receipt

### Fairness & compliance
- **Fairness audit** per run. Rather than guessing anybody's demographics, it runs a
  controlled substitution experiment: each resume is re-scored under several synthetic
  identities of deliberately varied name origin, with email, phone and location held
  constant. Zero spread is a proof, not a correlation — and the report breaks the
  movement down by scoring signal
- Also flags **identity fields inside the resumes** (date of birth, marital status,
  photograph) and **coded language in the job description**
- **Adverse impact** by the four-fifths rule, from voluntary self-reported data only,
  suppressed below a minimum group size
- **Data retention** — after a window you choose, candidate PII and stored resumes are
  erased in place while scores and counts survive, so History and Insights keep working
- **Candidate erasure requests**, raised by the candidate or by you

### Sources & automation
- Drag-and-drop upload (PDF/DOCX/TXT, plus scanned images via OCR)
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

**Supabase** (teams, history, jobs, applications, interviews, comments, audit log)
1. Project Settings → API → copy **Project URL** and **anon public** key into `frontend/.env`.
2. SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql). It is idempotent and
   carries its own v1 → v2 migration: existing single-user rows are moved into a personal
   organization per user, so nothing is lost. **Re-run it after pulling this version** —
   the team tables and the private `resumes` bucket are created here.
3. Restart `npm run dev`, then create an account on the login page. You become the admin
   of a new team; invite the rest from **Settings → Team**.

Without Supabase keys the app still screens resumes and runs the fairness audit; teams,
history, applications and interviews are disabled.

**Backend env for the candidate-facing features** (`backend/.env`):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service_role key>   # server-only, never in the frontend
PUBLIC_APP_URL=https://your-app.vercel.app
ADMIN_TOKEN=<random string>               # guards the cron endpoints below
ANTHROPIC_API_KEY=<optional, enables the AI second opinion>
```

The service-role key bypasses row-level security, which is exactly why the public apply
form and status page go through the backend: no table carries an anonymous insert policy.
Keep that key on the server only.

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

**Hosted (Render):** a server has no browser, so the sign-in must happen on a desktop.
Connect once locally, then in the Render dashboard add `backend/credentials.json` and
`backend/token.json` as **Secret Files** (they mount at `/etc/secrets/`) and set
`GMAIL_CREDENTIALS_FILE=/etc/secrets/credentials.json`,
`GMAIL_TOKEN_FILE=/etc/secrets/token.json` (the Blueprint already does). The secrets
mount is read-only, so refreshed tokens are kept in a working copy under `DATA_DIR`.
To switch the connected account or add the send permission, redo the local connect
and replace the `token.json` secret.

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
| POST | `/api/match/roles` | multipart: one resume vs. many roles -> best fit |
| GET | `/api/public/job/{token}` | public job details for the apply form |
| POST | `/api/public/apply/{token}` | multipart application (unauthenticated) |
| GET/POST | `/api/public/status/{token}` · `/book` · `/delete-request` | candidate status page |
| POST | `/api/admin/mail/drain` · `/api/admin/retention/run` · `/api/admin/erase` | cron triggers, require `X-Admin-Token` |
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
- Gmail runs as a single connected account per deployment (Desktop OAuth); per-user Gmail
  would need a Web OAuth client. The email queue therefore sends as that one account.
- Auto-screen watches and the email/retention workers live in the backend process, so on
  a host that sleeps they only run while it is awake. Point an external cron at
  `/api/admin/mail/drain` and `/api/admin/retention/run` there.
- The fairness audit re-scores the batch once per substituted identity, so it multiplies
  screening time. It is on by default and can be switched off per run.
- OCR reads the first few pages of a scan (`OCR_MAX_PAGES`, default 4) and is slower than
  text extraction.
- Interview scheduling has no calendar-provider integration; it emails an `.ics` invite.
