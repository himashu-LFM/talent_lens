import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import JobForm from "../components/JobForm";
import UploadZone from "../components/UploadZone";
import GmailPanel from "../components/GmailPanel";
import Results from "../components/Results";
import { useToast } from "../components/Toast";
import { ScreeningOverlay } from "../components/ui";
import { BellRing, Bookmark, BookmarkCheck, Mail, Play, Radar, Save, ScanLine, SlidersHorizontal, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import {
  deleteJob, listAllReviews, listJobs, listRuns, saveJob, saveRun, suggestWeights, type JobRow,
} from "../lib/db";
import {
  ackAutoResult, addWatch, analyzeJD, exportExcel, gmailScreen, listAutoResults, readiness, screen,
  type AutoResult, type ExportCandidate, type JDAnalysis, type ScreenResponse, type Weights,
} from "../api";

type Source = "upload" | "gmail";
const DEFAULT_W: Weights = { semantic: 40, skills: 30, relevance: 15, experience: 15 };
const W_LABEL: Record<keyof Weights, string> = {
  semantic: "Semantic fit", skills: "Skills coverage", relevance: "Keyword relevance", experience: "Experience",
};

export default function Dashboard() {
  const toast = useToast();
  const { user, configured } = useAuth();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [topN, setTopN] = useState(10);
  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<Source>("upload");

  const [gmailConnected, setGmailConnected] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [labelId, setLabelId] = useState("");
  const [labelName, setLabelName] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [markRead, setMarkRead] = useState(true);
  const [watchInterval, setWatchInterval] = useState(15);

  const [weights, setWeights] = useState<Weights>(DEFAULT_W);
  const [advanced, setAdvanced] = useState(false);
  const [semanticReady, setSemanticReady] = useState<boolean | null>(null);
  const [suggestion, setSuggestion] = useState<{ weights: Weights; positives: number; negatives: number } | null>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobId, setJobId] = useState<string>("");
  const [jd, setJd] = useState<JDAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [autoResults, setAutoResults] = useState<AutoResult[]>([]);
  const [data, setData] = useState<ScreenResponse | null>(null);
  const [dataFiles, setDataFiles] = useState<File[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasJD = description.trim().length > 0;
  const firstName = ((user?.user_metadata?.full_name as string) || user?.email || "there").split(/[@.\s]/)[0];

  useEffect(() => {
    readiness().then((r) => {
      setGmailConnected(r.gmail_connected);
      setCanSend(r.gmail_can_send);
      setSemanticReady(r.semantic_model === "ready");
      if (r.default_weights) setWeights(r.default_weights);
    }).catch(() => setSemanticReady(false));
    listAutoResults(true).then(setAutoResults).catch(() => {});
    if (configured && user) {
      listJobs().then(setJobs).catch(() => {});
      Promise.all([listRuns(), listAllReviews()])
        .then(([runs, reviews]) => setSuggestion(suggestWeights(runs, reviews, DEFAULT_W)))
        .catch(() => {});
    }
  }, [configured, user]);

  // ---- helpers ----
  function setFilesToasted(next: File[]) {
    const added = next.length - files.length;
    setFiles(next);
    if (added > 0) toast.info(`Added ${added} file${added === 1 ? "" : "s"}`);
  }

  async function persist(res: ScreenResponse, src: "upload" | "gmail" | "auto") {
    setRunId(null);
    if (configured && user && res.top.length > 0) {
      try {
        const id = await saveRun(user.id, title || res.job.title, src, res, jobId || null);
        setRunId(id);
        toast.info("Saved to history.");
      } catch (e) {
        toast.error(`History save failed: ${msg(e)}`, 6000);
      }
    }
  }

  function showResults(res: ScreenResponse, srcFiles: File[] = []) {
    setData(res);
    setDataFiles(srcFiles);
    requestAnimationFrame(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }));
    const fl = res.flagged?.length ?? 0;
    if (fl) toast.info(`${fl} file${fl === 1 ? "" : "s"} excluded — didn't look like a resume.`, 6000);
    if (res.errors.length) toast.error(`${res.errors.length} file(s) couldn't be read.`, 6000);
  }

  // ---- actions ----
  async function runUpload() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!files.length) return toast.error("Upload at least one resume.");
    setLoading(true); setData(null);
    const id = toast.loading(`Screening ${files.length} resume(s)…`);
    try {
      const res = await screen(title, description, topN, files, weights);
      showResults(res, files);
      toast.update(id, "success", `Ranked ${res.ranked.length} — showing top ${res.top.length}.`);
      await persist(res, "upload");
    } catch (e) {
      toast.update(id, "error", `Screening failed: ${msg(e)}`, 7000);
    } finally { setLoading(false); }
  }

  async function runGmail() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!labelId) return toast.error("Pick a Gmail label to screen.");
    setLoading(true); setData(null);
    const id = toast.loading("Fetching resumes from Gmail…");
    try {
      const res = await gmailScreen({ title, description, top_n: topN, label_id: labelId, unread_only: unreadOnly, mark_read: markRead, weights });
      if ((res.fetched ?? 0) === 0) {
        toast.update(id, "info", unreadOnly ? "No unread emails with resume attachments in that label." : "No resume attachments found in that label.", 6000);
        return;
      }
      showResults(res);
      toast.update(id, "success", `Fetched ${res.fetched} — ranked ${res.ranked.length}, showing top ${res.top.length}.`);
      if (markRead) toast.info("Screened emails marked as read.");
      await persist(res, "gmail");
    } catch (e) {
      toast.update(id, "error", `Gmail screening failed: ${msg(e)}`, 7000);
    } finally { setLoading(false); }
  }

  async function createWatch() {
    if (!hasJD) return toast.error("Add a job description first.");
    if (!labelId) return toast.error("Pick a Gmail label to watch.");
    try {
      await addWatch({ label_id: labelId, label_name: labelName, title, description, top_n: topN, interval_min: watchInterval, unread_only: unreadOnly, mark_read: markRead, weights });
      toast.success(`Auto-screen on: checking “${labelName || "label"}” every ${watchInterval} min. Manage in Settings.`, 6000);
    } catch (e) {
      toast.error(`Couldn't create watch: ${msg(e)}`);
    }
  }

  async function reviewAuto(r: AutoResult) {
    setTitle(r.result.job.title || r.title);
    showResults(r.result);
    setRunId(null);
    toast.info(`Loaded auto-screened batch from “${r.label_name}”.`);
  }
  async function saveAuto(r: AutoResult) {
    if (!(configured && user)) return toast.error("Sign in with history enabled to save.");
    try {
      const id = await saveRun(user.id, r.result.job.title || r.title, "auto", r.result, null);
      await ackAutoResult(r.id);
      setAutoResults((xs) => xs.filter((x) => x.id !== r.id));
      if (data === r.result) setRunId(id);
      toast.success("Saved to history.");
    } catch (e) {
      toast.error(`Save failed: ${msg(e)}`);
    }
  }
  async function dismissAuto(r: AutoResult) {
    await ackAutoResult(r.id).catch(() => {});
    setAutoResults((xs) => xs.filter((x) => x.id !== r.id));
  }

  async function doAnalyze() {
    if (!hasJD) return toast.error("Paste a job description first.");
    setAnalyzing(true);
    try { setJd(await analyzeJD(title, description)); } catch (e) { toast.error(`Analysis failed: ${msg(e)}`); } finally { setAnalyzing(false); }
  }

  async function doSaveJob() {
    if (!(configured && user)) return toast.error("Sign in with history enabled to save jobs.");
    if (!hasJD) return toast.error("Add a job description first.");
    try {
      const row = await saveJob(user.id, { id: jobId || undefined, title, description, top_n: topN, weights });
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

  async function doExport(rows: ExportCandidate[]) {
    if (!data) return;
    setExporting(true);
    const id = toast.loading("Building Excel file…");
    try { await exportExcel(rows, data.job.title || title); toast.update(id, "success", `Exported ${rows.length} candidate(s).`); }
    catch (e) { toast.update(id, "error", `Export failed: ${msg(e)}`, 6000); }
    finally { setExporting(false); }
  }

  const wTotal = Object.values(weights).reduce((a, b) => a + b, 0) || 1;

  return (
    <main className="page">
      <ScreeningOverlay open={loading} label={source === "gmail" ? "Fetching & screening from Gmail" : `Screening ${files.length || ""} resume${files.length === 1 ? "" : "s"}`} />
      <div className="page-head">
        <h1>Welcome back, {firstName} <span className="wave">👋</span></h1>
        <p>
          Define the role, add resumes from your device or a Gmail label, and get a transparent, ranked shortlist to review and export.
          {gmailConnected && <span className="inline-pill">● Gmail connected</span>}
          {semanticReady === true && <span className="inline-pill">● Semantic AI ready</span>}
          {semanticReady === false && <span className="inline-pill warn">Semantic model unavailable — lexical mode</span>}
        </p>
      </div>

      {autoResults.length > 0 && (
        <motion.div className="banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="banner-title">
            <BellRing size={16} /> <b>{autoResults.length} new auto-screened batch{autoResults.length === 1 ? "" : "es"}</b>
            <span className="muted"> — new applications arrived in your watched Gmail labels.</span>
          </div>
          <div className="banner-list">
            {autoResults.slice(0, 3).map((r) => (
              <div key={r.id} className="banner-item">
                <span>{r.title} · {r.result.fetched} resume{r.result.fetched === 1 ? "" : "s"} · {new Date(r.created_at).toLocaleString()}</span>
                <span className="head-actions">
                  <button className="btn btn-primary sm" onClick={() => reviewAuto(r)}>Review</button>
                  <button className="btn btn-ghost sm" onClick={() => saveAuto(r)}>Save to history</button>
                  <button className="link-btn" onClick={() => dismissAuto(r)}>Dismiss</button>
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <div className="workspace">
        <section className="col-main">
          <div className="panel">
            <div className="panel-head">
              <h2>Role details</h2>
              <div className="head-actions">
                {configured && (
                  <>
                    <select className="input tb-select" value={jobId} onChange={(e) => loadJob(e.target.value)}>
                      <option value="">Saved jobs…</option>
                      {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                    </select>
                    <button className="btn btn-ghost sm" onClick={doSaveJob} disabled={!hasJD}>{jobId ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} {jobId ? "Update job" : "Save job"}</button>
                    {jobId && <button className="btn btn-ghost sm danger icon-only" onClick={removeJob} title="Delete job"><Trash2 size={14} /></button>}
                  </>
                )}
                <button className="btn btn-ghost sm" onClick={doAnalyze} disabled={!hasJD || analyzing}><Wand2 size={14} /> {analyzing ? "Analyzing…" : "Analyze JD"}</button>
              </div>
            </div>
            <JobForm title={title} description={description} topN={topN} onTitle={(v) => { setTitle(v); setJd(null); }} onDescription={(v) => { setDescription(v); setJd(null); }} onTopN={setTopN} bare />
            {jd && (
              <div className={`jd-report grade-${jd.grade}`}>
                <div className="jd-head">
                  <span className="jd-grade">{jd.grade}</span>
                  <div>
                    <b>JD quality {jd.score}/100</b>
                    <div className="muted small">{jd.stats.words} words · {jd.stats.requirements} requirements detected{jd.stats.years_specified ? ` · ${jd.stats.years_specified}+ yrs` : ""}</div>
                  </div>
                </div>
                {jd.issues.length === 0 ? <p className="muted small">No issues — this JD will screen well.</p> : (
                  <ul className="jd-issues">
                    {jd.issues.map((i, k) => <li key={k} className={`sev-${i.severity}`}><b>{i.message}</b> <span className="muted">{i.suggestion}</span></li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Add resumes</h2>
              <div className="segmented" role="tablist">
                <button className={source === "upload" ? "seg on" : "seg"} onClick={() => setSource("upload")}><Upload size={14} /> Upload files</button>
                <button className={source === "gmail" ? "seg on" : "seg"} onClick={() => setSource("gmail")}><Mail size={14} /> From Gmail</button>
              </div>
            </div>
            <motion.div key={source} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              {source === "upload" ? (
                <>
                  <UploadZone files={files} onFiles={setFilesToasted} />
                  <button className="btn btn-primary full lg" onClick={runUpload} disabled={loading}>
                    <ScanLine size={17} /> {loading ? "Screening…" : `Screen ${files.length || ""} resume${files.length === 1 ? "" : "s"}`}
                  </button>
                </>
              ) : (
                <>
                  <GmailPanel labelId={labelId} unreadOnly={unreadOnly} markRead={markRead}
                    onLabel={(id, name) => { setLabelId(id); if (name) setLabelName(name); }}
                    onUnreadOnly={setUnreadOnly} onMarkRead={setMarkRead}
                    onConnectedChange={(c) => setGmailConnected(c)} />
                  <button className="btn btn-primary full lg" onClick={runGmail} disabled={loading || !gmailConnected}>
                    <ScanLine size={17} /> {loading ? "Screening…" : "Screen resumes from Gmail"}
                  </button>
                  {gmailConnected && (
                    <div className="watch-row">
                      <div className="watch-title">
                        <Radar size={16} /> <b>Auto-screen this label</b>
                        <div className="muted small">Check for new applications automatically and notify you here.</div>
                      </div>
                      <label className="watch-int">every <input className="input topn-num sm" type="number" min={2} max={1440} value={watchInterval} onChange={(e) => setWatchInterval(Math.max(2, Number(e.target.value) || 15))} /> min</label>
                      <button className="btn btn-ghost sm" onClick={createWatch} disabled={!hasJD || !labelId}><Play size={13} /> Turn on</button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </div>
        </section>

        <aside className="col-side">
          <div className="panel how">
            <div className="panel-head tight">
              <h3><SlidersHorizontal size={15} /> Scoring weights</h3>
              <button className="link-btn" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Done" : "Tune"}</button>
            </div>
            <ul>
              {(Object.keys(W_LABEL) as (keyof Weights)[]).map((k) => (
                <li key={k} className={advanced ? "editing" : ""}>
                  <b>{W_LABEL[k]}</b>
                  {advanced && <input type="range" min={0} max={70} value={weights[k]} className="slider w-slider" onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />}
                  <span>{Math.round((weights[k] / wTotal) * 100)}%</span>
                </li>
              ))}
            </ul>
            {advanced && <button className="link-btn" onClick={() => setWeights(DEFAULT_W)}>Reset to defaults</button>}
            {suggestion && (
              <div className="suggest">
                <b><Sparkles size={14} /> Learned from your decisions</b>
                <p className="muted small">Based on {suggestion.positives} advanced and {suggestion.negatives} rejected candidates, these weights would better match how you actually decide.</p>
                <div className="tags sm">{(Object.keys(W_LABEL) as (keyof Weights)[]).map((k) => <span key={k} className="tag neutral">{W_LABEL[k]} {suggestion.weights[k]}%</span>)}</div>
                <button className="btn btn-ghost sm" onClick={() => { setWeights(suggestion.weights); toast.success("Suggested weights applied."); }}><Save size={13} /> Apply</button>
              </div>
            )}
            <p className="how-note">Hybrid engine: on-device semantic matching + must-have skill gating (with “A or B” alternatives) + BM25 relevance + date-based experience. Fully offline.</p>
          </div>
          {!configured && (
            <div className="panel warn-panel"><b>History off</b><p>Add Supabase keys to <code>frontend/.env</code> to save runs, jobs, statuses and notes.</p></div>
          )}
        </aside>
      </div>

      <div id="results">
        {data && (data.top.length > 0 || (data.flagged?.length ?? 0) > 0) && (
          <Results data={data} runId={runId} files={dataFiles} canSend={canSend} onExport={doExport} exporting={exporting} />
        )}
      </div>
    </main>
  );
}

function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
