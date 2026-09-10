/* "Screen" — the new-run workspace. KPI cards, auto-screen banner, describe-the-role
   card and add-resumes card; scoring weights live in the context sidebar. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BellRing, Bookmark, BookmarkCheck, Bot, FileSearch, ListOrdered, Mail, Play, Radar,
  Save, ScanLine, Scale, Sparkles, Target, Trash2, TrendingUp, Upload, Wand2,
} from "lucide-react";
import UploadZone from "../components/UploadZone";
import GmailPanel from "../components/GmailPanel";
import { useToast } from "../components/Toast";
import { ScreeningOverlay } from "../components/ui";
import { Eyebrow, ProgressBar, SegTabs, StatCard } from "../components/ds";
import { Sidebar, useWorkspace } from "../context/Workspace";
import { useAuth } from "../auth/AuthProvider";
import {
  canWrite, deleteJob, listAllReviews, listJobs, listRuns, saveJob, saveRun,
  suggestWeights, uploadResumes, type JobRow,
} from "../lib/db";
import {
  ackAutoResult, addWatch, analyzeJD, gmailScreen, listAutoResults, screen,
  type AutoResult, type JDAnalysis, type ScreenResponse, type Weights,
} from "../api";

type Source = "upload" | "gmail";
const DEFAULT_W: Weights = { semantic: 40, skills: 30, relevance: 15, experience: 15 };
const W_LABEL: Record<keyof Weights, string> = {
  semantic: "Semantic fit", skills: "Skills coverage", relevance: "Keyword relevance", experience: "Experience",
};

export default function Dashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const { user, configured } = useAuth();
  const { run, setRun, setDraftTitle, ready, refreshReady, resetFilters, orgId, role } = useWorkspace();
  const mayWrite = canWrite(role) || !configured;

  const [title, setTitle] = useState(run?.source !== "history" ? run?.title ?? "" : "");
  const [description, setDescription] = useState("");
  const [topN, setTopN] = useState(10);
  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<Source>("upload");

  const [gmailConnected, setGmailConnected] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [labelName, setLabelName] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [markRead, setMarkRead] = useState(true);
  const [watchInterval, setWatchInterval] = useState(15);

  const [weights, setWeights] = useState<Weights>(DEFAULT_W);
  const [tune, setTune] = useState(false);
  const [suggestion, setSuggestion] = useState<{ weights: Weights; positives: number; negatives: number } | null>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState("");
  const [jd, setJd] = useState<JDAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [autoResults, setAutoResults] = useState<AutoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState(true);
  const [deep, setDeep] = useState(false);

  const hasJD = description.trim().length > 0;

  useEffect(() => { setDraftTitle(title); }, [title, setDraftTitle]);
  useEffect(() => {
    if (ready?.default_weights) setWeights(ready.default_weights);
    setGmailConnected(!!ready?.gmail_connected);
  }, [ready]);
  useEffect(() => {
    listAutoResults(true).then(setAutoResults).catch(() => {});
    if (configured && user) {
      listJobs().then(setJobs).catch(() => {});
      Promise.all([listRuns(), listAllReviews()])
        .then(([runs, reviews]) => setSuggestion(suggestWeights(runs, reviews, DEFAULT_W)))
        .catch(() => {});
    }
  }, [configured, user]);

  // ---- run lifecycle ----
  async function finish(res: ScreenResponse, src: "upload" | "gmail" | "auto", srcFiles: File[]) {
    resetFilters();
    setRun({
      data: res, runId: null, files: srcFiles, title: title || res.job.title,
      source: src, jobId: jobId || null, at: new Date().toISOString(),
    });
    const fl = res.flagged?.length ?? 0;
    if (fl) toast.info(`${fl} file${fl === 1 ? "" : "s"} excluded — didn't look like a resume.`, 6000);
    if (res.errors.length) toast.error(`${res.errors.length} file(s) couldn't be read.`, 6000);
    if (res.llm && !res.llm.ran && deep) {
      toast.info(`AI second opinion skipped: ${res.llm.reason ?? "not configured"}.`, 6000);
    }
    nav("/shortlist");

    if (!(configured && user && orgId && res.top.length > 0)) return;
    let runIdSaved: string | null = null;
    try {
      runIdSaved = await saveRun(orgId, user.id, title || res.job.title, src, res, jobId || null);
      setRun((r) => (r && r.data === res ? { ...r, runId: runIdSaved } : r));
      toast.info("Saved to history.");
    } catch (e) {
      toast.error(`History save failed: ${msg(e)}`, 6000);
      return;
    }

    // Keep the original documents so a re-opened run can still show the PDF.
    if (runIdSaved && srcFiles.length) {
      const byName = new Map(srcFiles.map((f) => [f.name, f]));
      const items = res.ranked
        .map((c) => ({ key: (c.email || c.filename || "").toLowerCase(), file: byName.get(c.filename) }))
        .filter((x): x is { key: string; file: File } => !!x.file && !!x.key);
      if (items.length) {
        const { stored, failed } = await uploadResumes(orgId, user.id, runIdSaved, items);
        if (stored) toast.info(`Stored ${stored} resume${stored === 1 ? "" : "s"} for later review.`, 4000);
        if (failed) toast.error(`${failed} resume${failed === 1 ? "" : "s"} couldn't be stored.`, 5000);
      }
    }
  }

  async function runUpload() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!files.length) return toast.error("Upload at least one resume.");
    setLoading(true);
    const id = toast.loading(`Screening ${files.length} resume(s)…`);
    try {
      const res = await screen(title, description, topN, files,
                               { weights, audit, deep, deepTopN: topN });
      toast.update(id, "success", `Ranked ${res.ranked.length} — showing top ${res.top.length}.`);
      await finish(res, "upload", files);
    } catch (e) { toast.update(id, "error", `Screening failed: ${msg(e)}`, 7000); }
    finally { setLoading(false); }
  }

  async function runGmail() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!labelId) return toast.error("Pick a Gmail label to screen.");
    setLoading(true);
    const id = toast.loading("Fetching resumes from Gmail…");
    try {
      const res = await gmailScreen({
        title, description, top_n: topN, label_id: labelId,
        unread_only: unreadOnly, mark_read: markRead, weights,
        audit, deep, deep_top_n: topN,
      });
      if ((res.fetched ?? 0) === 0) {
        toast.update(id, "info", unreadOnly ? "No unread emails with resume attachments in that label." : "No resume attachments found in that label.", 6000);
        return;
      }
      toast.update(id, "success", `Fetched ${res.fetched} — ranked ${res.ranked.length}, showing top ${res.top.length}.`);
      if (markRead) toast.info("Screened emails marked as read.");
      await finish(res, "gmail", []);
    } catch (e) { toast.update(id, "error", `Gmail screening failed: ${msg(e)}`, 7000); }
    finally { setLoading(false); }
  }

  async function createWatch() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!labelId) return toast.error("Pick a Gmail label to watch.");
    try {
      await addWatch({ label_id: labelId, label_name: labelName, title, description, top_n: topN, interval_min: watchInterval, unread_only: unreadOnly, mark_read: markRead, weights });
      toast.success(`Auto-screen on: checking “${labelName || "label"}” every ${watchInterval} min. Manage in Settings.`, 6000);
      refreshReady();
    } catch (e) { toast.error(`Couldn't create watch: ${msg(e)}`); }
  }

  async function reviewAuto(r: AutoResult) {
    resetFilters();
    setRun({
      data: r.result, runId: null, files: [], title: r.result.job.title || r.title,
      source: "auto", jobId: null, at: r.created_at,
    });
    toast.info(`Loaded auto-screened batch from “${r.label_name}”.`);
    nav("/shortlist");
    if (configured && user && orgId) {
      try {
        const id = await saveRun(orgId, user.id, r.result.job.title || r.title, "auto", r.result, null);
        await ackAutoResult(r.id);
        setAutoResults((xs) => xs.filter((x) => x.id !== r.id));
        setRun((cur) => (cur && cur.data === r.result ? { ...cur, runId: id } : cur));
        refreshReady();
      } catch (e) { toast.error(`Save failed: ${msg(e)}`); }
    }
  }
  async function dismissAuto(r: AutoResult) {
    await ackAutoResult(r.id).catch(() => {});
    setAutoResults((xs) => xs.filter((x) => x.id !== r.id));
    refreshReady();
  }

  async function doAnalyze() {
    if (!hasJD) return toast.error("Paste a job description first.");
    setAnalyzing(true);
    try { setJd(await analyzeJD(title, description)); } catch (e) { toast.error(`Analysis failed: ${msg(e)}`); } finally { setAnalyzing(false); }
  }
  async function doSaveJob() {
    if (!(configured && user && orgId)) return toast.error("Sign in with history enabled to save jobs.");
    if (!mayWrite) return toast.error("Your role is read-only for jobs.");
    if (!hasJD) return toast.error("Add a job description first.");
    try {
      const row = await saveJob(orgId, user.id, { id: jobId || undefined, title, description, top_n: topN, weights });
      setJobs((js) => [row, ...js.filter((j) => j.id !== row.id)]);
      setJobId(row.id);
      toast.success(`Job “${row.title}” saved.`);
    } catch (e) { toast.error(`Save failed: ${msg(e)}`); }
  }
  function loadJob(id: string) {
    setJobId(id);
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    setTitle(j.title); setDescription(j.description); setTopN(j.top_n);
    if (j.weights) setWeights(j.weights);
    setJd(null);
    toast.info(`Loaded “${j.title}”.`);
  }
  async function removeJob() {
    if (!jobId) return;
    try { await deleteJob(jobId); setJobs((js) => js.filter((j) => j.id !== jobId)); setJobId(""); toast.success("Job deleted."); }
    catch (e) { toast.error(`Delete failed: ${msg(e)}`); }
  }

  const wTotal = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const pct = (k: keyof Weights) => Math.round((weights[k] / wTotal) * 100);
  const avg = useMemo(() => run?.data.top.length ? Math.round((run.data.top.reduce((s, c) => s + c.score, 0) / run.data.top.length) * 10) / 10 : 0, [run]);
  const fileCount = files.length;

  return (
    <div className="page narrow stack">
      <ScreeningOverlay open={loading} label={source === "gmail" ? "Fetching & screening from Gmail" : `Screening ${fileCount || ""} resume${fileCount === 1 ? "" : "s"}`} />

      <Sidebar>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>Scoring weights</Eyebrow>
            <button className="link-btn muted small" onClick={() => setTune((t) => !t)} style={{ marginBottom: 10 }}>{tune ? "Done" : "Tune"}</button>
          </div>
          <div className="weights">
            {(Object.keys(W_LABEL) as (keyof Weights)[]).map((k) => (
              <div key={k} className="weight-row">
                <div className="l"><span>{W_LABEL[k]}</span><b>{pct(k)}%</b></div>
                <ProgressBar value={pct(k)} tone="amber" />
                {tune && <input type="range" className="range" min={0} max={70} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} aria-label={`${W_LABEL[k]} weight`} />}
              </div>
            ))}
          </div>
          {tune && <button className="link-btn muted small" style={{ marginTop: 10 }} onClick={() => setWeights(DEFAULT_W)}>Reset to defaults</button>}
          {suggestion && (
            <div className="suggest">
              <div className="t"><Sparkles size={14} /> Learned from your decisions</div>
              <p>From {suggestion.positives} advanced and {suggestion.negatives} rejected candidates, {describeSuggestion(suggestion.weights, weights)} would better match how you actually decide.</p>
              <button className="btn btn-ghost sm" onClick={() => { setWeights(suggestion.weights); toast.success("Suggested weights applied."); }}>Apply suggestion</button>
            </div>
          )}
        </div>
        <div>
          <Eyebrow>Shortlist size</Eyebrow>
          <div className="ctx-range">
            <div className="l"><span>Top candidates to keep</span><b>{topN}</b></div>
            <input type="range" className="range" min={1} max={50} value={Math.min(topN, 50)} onChange={(e) => setTopN(Number(e.target.value))} aria-label="Shortlist size" />
          </div>
        </div>

        <div>
          <Eyebrow>Before you decide</Eyebrow>
          <label className="ctx-check" style={{ marginBottom: 10 }}>
            <input type="checkbox" className="check" checked={audit} onChange={(e) => setAudit(e.target.checked)} />
            <span><Scale size={13} style={{ verticalAlign: -2 }} /> Fairness audit</span>
          </label>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Re-scores everyone under substituted names to prove the ranking does not read identity.
          </p>
          <label className="ctx-check" style={{ opacity: ready?.llm?.available ? 1 : 0.55 }}>
            <input type="checkbox" className="check" checked={deep}
              disabled={!ready?.llm?.available}
              onChange={(e) => setDeep(e.target.checked)} />
            <span><Bot size={13} style={{ verticalAlign: -2 }} /> AI second opinion</span>
          </label>
          <p className="hint" style={{ marginTop: 6 }}>
            {ready?.llm?.available
              ? `Assesses your top ${Math.min(topN, ready.llm.max_candidates)} with ${ready.llm.model}. Costs API credits.`
              : "Needs an Anthropic API key on the server."}
          </p>
        </div>
        {!configured && (
          <div className="notice"><b>History off.</b> Add Supabase keys to <code>frontend/.env</code> to save runs, jobs, statuses and notes.</div>
        )}
      </Sidebar>

      <div className="stats-4">
        <StatCard tone="blue" title="Resumes screened" value={run?.data.total_resumes ?? 0} sub={run ? "last run" : "no runs yet"} icon={<FileSearch size={20} />} />
        <StatCard tone="amber" title="Shortlisted" value={run?.data.top.length ?? 0} sub="top-N kept" icon={<ListOrdered size={20} />} />
        <StatCard tone="emerald" title="Average score" value={avg} decimals={1} sub="across the shortlist" icon={<TrendingUp size={20} />} />
        <StatCard tone="purple" title="Auto-screen watches" value={ready?.watches ?? 0} sub={`${ready?.unacked_auto_results ?? 0} new result${(ready?.unacked_auto_results ?? 0) === 1 ? "" : "s"}`} icon={<Target size={20} />} />
      </div>

      {autoResults.length > 0 && (
        <div className="banner fade-in" role="status">
          <BellRing size={18} />
          <div className="banner-body">
            <div className="banner-title">{autoResults.length} new auto-screened batch{autoResults.length === 1 ? "" : "es"}</div>
            <div className="banner-sub ellipsis">{autoResults.slice(0, 2).map((r) => `${r.title} · ${r.result.fetched} resume${r.result.fetched === 1 ? "" : "s"}`).join(" · and ")}</div>
          </div>
          <div className="banner-actions">
            <button className="btn btn-primary sm" onClick={() => reviewAuto(autoResults[0])}>Review</button>
            <button className="btn btn-secondary sm" onClick={() => dismissAuto(autoResults[0])}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Describe the role</h2>
            <div className="actions">
              {configured && (
                <>
                  <select className="input" style={{ height: 34, width: 150, fontSize: 12.5, borderRadius: 9 }} value={jobId} onChange={(e) => loadJob(e.target.value)} aria-label="Saved jobs">
                    <option value="">Saved jobs…</option>
                    {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                  </select>
                  <button className="btn btn-ghost sm" onClick={doSaveJob} disabled={!hasJD}>{jobId ? <BookmarkCheck size={13} /> : <Bookmark size={13} />} {jobId ? "Update" : "Save"}</button>
                  {jobId && <button className="btn btn-ghost sm danger icon-only" onClick={removeJob} title="Delete job" aria-label="Delete job"><Trash2 size={13} /></button>}
                </>
              )}
              <button className="btn btn-ghost sm" onClick={doAnalyze} disabled={!hasJD || analyzing}><Wand2 size={13} /> {analyzing ? "Analyzing…" : "Analyze JD"}</button>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="job-title">Job title</label>
            <input id="job-title" className="input" placeholder="e.g. Senior AI Engineer" value={title} onChange={(e) => { setTitle(e.target.value); setJd(null); }} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="job-desc">Job description</label>
            <textarea id="job-desc" className="input textarea" rows={7}
              placeholder="Paste the full job description. Use “must have” for critical skills, “nice to have” for optional ones, and “X or Y” for alternatives."
              value={description} onChange={(e) => { setDescription(e.target.value); setJd(null); }} />
          </div>
          {jd && (
            <div className={`jd-report grade-${jd.grade}`}>
              <span className="jd-grade">{jd.grade}</span>
              <div className="jd-body">
                <b className="t">JD quality {jd.score}/100</b>
                <div className="m">{jd.stats.words} words · {jd.stats.requirements} requirements detected{jd.stats.years_specified ? ` · ${jd.stats.years_specified}+ yrs` : ""}</div>
                {jd.issues.length === 0
                  ? <div className="jd-issue"><b style={{ color: "var(--success)" }}>No issues.</b> This JD will screen well.</div>
                  : jd.issues.map((i, k) => <div key={k} className={`jd-issue sev-${i.severity}`}><b>{i.message}</b> {i.suggestion}</div>)}
              </div>
            </div>
          )}
        </section>

        <section className="card col">
          <div className="card-head">
            <h2>Add resumes</h2>
            <SegTabs small value={source} onChange={setSource} items={[
              { value: "upload", label: <><Upload size={13} /> Upload</> },
              { value: "gmail", label: <><Mail size={13} /> Gmail</> },
            ]} />
          </div>
          <div key={source} className="fade-in source-body" style={{ flex: 1 }}>
            {source === "upload" ? (
              <UploadZone files={files} onFiles={(next) => { const added = next.length - files.length; setFiles(next); if (added > 0) toast.info(`Added ${added} file${added === 1 ? "" : "s"}`); }} />
            ) : (
              <>
                <GmailPanel labelId={labelId} unreadOnly={unreadOnly} markRead={markRead}
                  onLabel={(id, name) => { setLabelId(id); if (name) setLabelName(name); }}
                  onUnreadOnly={setUnreadOnly} onMarkRead={setMarkRead}
                  onConnectedChange={(c) => setGmailConnected(c)} />
                {gmailConnected && (
                  <div className="watch-row">
                    <div className="watch-main">
                      <b><Radar size={14} style={{ verticalAlign: -2, color: "var(--accent-text)" }} /> Auto-screen this label</b>
                      <div className="m">Check for new applications automatically and notify you here.</div>
                    </div>
                    <label className="watch-int">every <input className="input num-input sm" type="number" min={2} max={1440} value={watchInterval} onChange={(e) => setWatchInterval(Math.max(2, Number(e.target.value) || 15))} aria-label="Interval in minutes" /> min</label>
                    <button className="btn btn-ghost sm" onClick={createWatch} disabled={!hasJD || !labelId}><Play size={13} /> Turn on</button>
                  </div>
                )}
              </>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 18 }} />
          {source === "upload" ? (
            <button className="btn btn-primary full lg" style={{ marginTop: 18 }} onClick={runUpload} disabled={loading}>
              <ScanLine size={17} /> {loading ? "Screening…" : `Screen ${fileCount || ""} resume${fileCount === 1 ? "" : "s"}`}
            </button>
          ) : (
            <button className="btn btn-primary full lg" style={{ marginTop: 18 }} onClick={runGmail} disabled={loading || !gmailConnected}>
              <ScanLine size={17} /> {loading ? "Screening…" : "Screen resumes from Gmail"}
            </button>
          )}
        </section>
      </div>

      {run && (
        <div className="notice-row" style={{ marginTop: 0 }}>
          <Save size={15} />
          <span>Last run: <b>{run.title || run.data.job.title}</b> — {run.data.total_resumes} screened, {run.data.top.length} shortlisted.</span>
          <span className="grow" />
          <button className="link-btn" onClick={() => nav("/shortlist")}>Open shortlist →</button>
        </div>
      )}
    </div>
  );
}

function describeSuggestion(s: Weights, cur: Weights) {
  const keys = Object.keys(s) as (keyof Weights)[];
  const up = keys.filter((k) => s[k] > cur[k]).sort((a, b) => (s[b] - cur[b]) - (s[a] - cur[a]))[0];
  return up ? `weighting ${W_LABEL[up].toLowerCase()} higher` : "these weights";
}
function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
