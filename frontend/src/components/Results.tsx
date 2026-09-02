import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Columns3, Download, EyeOff, Grid3X3, KanbanSquare, Printer, Send, Table2 } from "lucide-react";
import { Num } from "./ui";
import CandidateDrawer from "./CandidateDrawer";
import type { Candidate, ExportCandidate, ScreenResponse } from "../api";
import { gmailSend } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "./Toast";
import {
  STATUSES, bulkUpsertReviews, candidateKey, listReviews, priorAppearances, upsertReview,
  type Review, type ReviewStatus,
} from "../lib/db";

interface Props {
  data: ScreenResponse;
  runId?: string | null;
  files?: File[];
  canSend?: boolean;
  onExport: (rows: ExportCandidate[]) => void;
  exporting: boolean;
}

type SortKey = "score" | "experience" | "name";
type View = "table" | "heatmap" | "board";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New", shortlisted: "Shortlisted", interview: "Interview", rejected: "Rejected", hired: "Hired",
};
const scoreClass = (s: number) => (s >= 70 ? "high" : s >= 40 ? "mid" : "low");

function requirementUnits(data: ScreenResponse): { label: string; members: string[] }[] {
  const groups = data.job.alternative_groups ?? [];
  const grouped = new Set(groups.flat());
  const units = data.job.required_skills.filter((s) => !grouped.has(s)).map((s) => ({ label: s, members: [s] }));
  groups.forEach((g) => units.push({ label: g.join(" or "), members: g }));
  (data.job.extra_requirements ?? []).forEach((s) => units.push({ label: s, members: [s] }));
  return units;
}

export default function Results({ data, runId, files, canSend, onExport, exporting }: Props) {
  const toast = useToast();
  const { user, configured } = useAuth();

  const [view, setView] = useState<View>("table");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewStatus>("all");
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [anon, setAnon] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState(false);
  const [reviews, setReviews] = useState<Map<string, Review>>(new Map());
  const [prior, setPrior] = useState<Map<string, number>>(new Map());
  const [active, setActive] = useState(0);
  const [drawerIdx, setDrawerIdx] = useState<number | null>(null);
  const [emailTo, setEmailTo] = useState<Candidate | null>(null);
  const [viewFile, setViewFile] = useState<{ url: string; name: string } | null>(null);
  const [bulkMin, setBulkMin] = useState(70);

  const canPersist = configured && !!user && !!runId;
  const fileMap = useMemo(() => new Map((files ?? []).map((f) => [f.name, f])), [files]);

  useEffect(() => {
    if (!configured || !user) return;
    if (runId) listReviews(runId).then(setReviews).catch(() => {});
    priorAppearances(data.ranked.map((c) => c.email), runId ?? undefined).then(setPrior).catch(() => {});
  }, [configured, user, runId, data]);

  const reviewOf = (c: Candidate) => reviews.get(candidateKey(c));
  const statusOf = (c: Candidate): ReviewStatus => reviewOf(c)?.status ?? "new";
  const displayName = (c: Candidate) => (anon ? `Candidate #${c.rank}` : c.name);

  function setLocal(c: Candidate, patch: Partial<Review>) {
    const key = candidateKey(c);
    const next = new Map(reviews);
    next.set(key, { ...(reviews.get(key) ?? emptyReview(runId ?? "", key, c)), ...patch });
    setReviews(next);
  }

  async function setStatus(c: Candidate, status: ReviewStatus, quiet = false) {
    setLocal(c, { status });
    if (!canPersist) { if (!quiet) toast.info("Status set locally — enable history (Supabase) to save.", 3500); return; }
    try {
      await upsertReview(user!.id, runId!, candidateKey(c), { status, name: c.name, email: c.email });
      if (!quiet) toast.success(`${displayName(c)} → ${STATUS_LABEL[status]}`, 2500);
    } catch (e) { toast.error(`Couldn't save status: ${msg(e)}`); }
  }

  async function bulkStatus(cands: Candidate[], status: ReviewStatus) {
    if (!cands.length) return;
    const next = new Map(reviews);
    cands.forEach((c) => { const key = candidateKey(c); next.set(key, { ...(reviews.get(key) ?? emptyReview(runId ?? "", key, c)), status }); });
    setReviews(next);
    if (canPersist) {
      try { await bulkUpsertReviews(user!.id, runId!, cands.map((c) => ({ key: candidateKey(c), status, name: c.name, email: c.email }))); }
      catch (e) { return toast.error(`Bulk save failed: ${msg(e)}`); }
    }
    toast.success(`${cands.length} candidate${cands.length === 1 ? "" : "s"} → ${STATUS_LABEL[status]}`);
    setSelected(new Set());
  }

  async function saveNotes(c: Candidate, notes: string) {
    setLocal(c, { notes });
    if (!canPersist) return;
    try { await upsertReview(user!.id, runId!, candidateKey(c), { notes, name: c.name, email: c.email }); toast.success("Notes saved.", 1800); }
    catch (e) { toast.error(`Couldn't save notes: ${msg(e)}`); }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.top.filter((c) => {
      if (c.score < minScore) return false;
      if (statusFilter !== "all" && statusOf(c) !== statusFilter) return false;
      if (!q) return true;
      return `${c.name} ${c.email} ${c.filename} ${c.matched_skills.join(" ")} ${c.skills.join(" ")}`.toLowerCase().includes(q);
    });
    list = [...list].sort((a, b) =>
      sortKey === "score" ? b.score - a.score || b.experience_years - a.experience_years
      : sortKey === "experience" ? b.experience_years - a.experience_years || b.score - a.score
      : a.name.localeCompare(b.name));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, statusFilter, minScore, sortKey, reviews]);

  useEffect(() => { if (drawerIdx !== null && drawerIdx >= rows.length) setDrawerIdx(rows.length ? rows.length - 1 : null); }, [rows, drawerIdx]);

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.ctrlKey || e.metaKey) return;
      if (view !== "table" || !rows.length) return;
      const idx = drawerIdx ?? active;
      const c = rows[idx];
      if (e.key === "j") { const n = Math.min(idx + 1, rows.length - 1); setActive(n); if (drawerIdx !== null) setDrawerIdx(n); }
      else if (e.key === "k") { const n = Math.max(idx - 1, 0); setActive(n); if (drawerIdx !== null) setDrawerIdx(n); }
      else if (e.key === "s" && c) setStatus(c, "shortlisted");
      else if (e.key === "r" && c) setStatus(c, "rejected");
      else if (e.key === "i" && c) setStatus(c, "interview");
      else if ((e.key === "e" || e.key === "Enter") && c && drawerIdx === null) setDrawerIdx(idx);
      else if (e.key === "a") setAnon((x) => !x);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, active, view, reviews, drawerIdx]);

  const selectedCands = data.top.filter((c) => selected.has(candidateKey(c)));
  function toggleSelect(c: Candidate) {
    const key = candidateKey(c); const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key); setSelected(next);
  }
  function doExport() { onExport(rows.map((c) => ({ ...c, status: statusOf(c), notes: reviewOf(c)?.notes ?? "" }))); }
  function openResume(c: Candidate) {
    const f = fileMap.get(c.filename);
    if (!f) return toast.info("Original file isn't available for this candidate (Gmail/history runs).", 4000);
    setViewFile({ url: URL.createObjectURL(f), name: f.name });
  }

  const units = useMemo(() => requirementUnits(data), [data]);
  const avg = data.top.length ? Math.round((data.top.reduce((s, c) => s + c.score, 0) / data.top.length) * 10) / 10 : 0;
  const flagged = data.flagged ?? [];
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: data.top.filter((c) => statusOf(c) === s).length }), {} as Record<ReviewStatus, number>);
  const drawerCand = drawerIdx !== null ? rows[drawerIdx] : null;

  return (
    <motion.section className="panel results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="panel-head">
        <div>
          <h2>Shortlist</h2>
          <p className="results-sub">
            {data.total_resumes} screened · {data.top.length} shortlisted
            {flagged.length ? ` · ${flagged.length} excluded as non-resumes` : ""}{runId ? " · saved to history" : ""}
            <span className="kbd-hint"> · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>s</kbd> shortlist · <kbd>r</kbd> reject · <kbd>i</kbd> interview · <kbd>a</kbd> anonymize</span>
          </p>
        </div>
        <div className="head-actions">
          <div className="segmented small" role="tablist">
            {(["table", "heatmap", "board"] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "seg on" : "seg"} onClick={() => setView(v)}>
                {v === "table" ? <Table2 size={14} /> : v === "heatmap" ? <Grid3X3 size={14} /> : <KanbanSquare size={14} />}
                {v === "table" ? "Table" : v === "heatmap" ? "Heatmap" : "Pipeline"}
              </button>
            ))}
          </div>
          <label className={`pill-toggle ${anon ? "on" : ""}`}><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /><EyeOff size={14} /><span>{anon ? "Anonymized" : "Anonymize"}</span></label>
          <button className="btn btn-ghost sm" disabled={selectedCands.length < 2 || selectedCands.length > 3} onClick={() => setCompare(true)}><Columns3 size={14} /> Compare {selectedCands.length ? `(${selectedCands.length})` : ""}</button>
          <button className="btn btn-ghost sm" onClick={() => window.print()}><Printer size={14} /> Print</button>
          <button className="btn btn-ghost sm" onClick={doExport} disabled={exporting}><Download size={14} /> {exporting ? "Exporting…" : "Export Excel"}</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-num"><Num value={data.total_resumes} /></div><div className="stat-label">Resumes screened</div></div>
        <div className="stat"><div className="stat-num"><Num value={data.top.length} /></div><div className="stat-label">Shortlisted</div></div>
        <div className="stat"><div className="stat-num accent"><Num value={avg} decimals={1} /></div><div className="stat-label">Avg. score</div></div>
        <div className="stat"><div className="stat-num">{counts.shortlisted + counts.interview + counts.hired}</div><div className="stat-label">Advanced · {counts.rejected} rejected</div></div>
        <div className="stat grow">
          <div className="stat-label">Requirements ({units.length})</div>
          <div className="tags sm">
            {units.map((u) => <span key={u.label} className={`tag neutral ${u.members.length > 1 ? "or" : ""}`}>{u.label}</span>)}
            {!units.length && <span className="muted">none detected — add specific skills to the JD</span>}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <input className="input tb-search" placeholder="Search name, email, skill…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search candidates" />
        <select className="input tb-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]} ({counts[s]})</option>)}
        </select>
        <select className="input tb-select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Sort">
          <option value="score">Sort: Score</option><option value="experience">Sort: Experience</option><option value="name">Sort: Name</option>
        </select>
        <label className="tb-range"><span>Min score <b>{minScore}</b></span><input type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="slider" /></label>
      </div>

      <div className="bulkbar">
        <span className="muted">{selectedCands.length ? `${selectedCands.length} selected` : "Bulk actions"}</span>
        <button className="link-btn" onClick={() => setSelected(new Set(rows.map(candidateKey)))}>Select all filtered</button>
        {selectedCands.length > 0 && (<>
          <button className="btn btn-ghost sm" onClick={() => bulkStatus(selectedCands, "shortlisted")}>Shortlist selected</button>
          <button className="btn btn-ghost sm danger" onClick={() => bulkStatus(selectedCands, "rejected")}>Reject selected</button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>Clear</button>
        </>)}
        <span className="bulk-sep" />
        <label className="bulk-min">Shortlist everyone ≥ <input className="input topn-num sm" type="number" min={0} max={100} value={bulkMin} onChange={(e) => setBulkMin(Number(e.target.value))} aria-label="Minimum score" /></label>
        <button className="btn btn-primary sm" onClick={() => bulkStatus(data.top.filter((c) => c.score >= bulkMin && statusOf(c) === "new"), "shortlisted")}>Apply</button>
      </div>

      {view === "table" && (
        <div className="table-wrap">
          <table className="tbl tbl-fixed">
            <colgroup>
              <col style={{ width: 36 }} /><col style={{ width: 48 }} /><col />
              {!anon && <col style={{ width: "19%" }} />}{!anon && <col className="hide-md" style={{ width: 140 }} />}
              <col style={{ width: 62 }} /><col style={{ width: 150 }} /><col style={{ width: 128 }} />
            </colgroup>
            <thead><tr><th></th><th>#</th><th>Candidate</th>{!anon && <th>Email</th>}{!anon && <th className="hide-md">Phone</th>}<th>Exp.</th><th>Score</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="tbl-empty">No candidates match these filters.</td></tr>}
              {rows.map((c, idx) => {
                const status = statusOf(c);
                const pr = prior.get((c.email || "").toLowerCase()) ?? 0;
                return (
                  <tr key={candidateKey(c) + c.rank} className={`row ${c.rank <= 3 ? "row-top" : ""} ${idx === active ? "row-active" : ""} ${drawerIdx === idx ? "row-open" : ""} st-${status}`}
                    onClick={() => { setActive(idx); setDrawerIdx(idx); }}>
                    <td className="c-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(candidateKey(c))} onChange={() => toggleSelect(c)} aria-label={`Select ${displayName(c)}`} /></td>
                    <td className="c-rank"><span className={`rank-badge ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span></td>
                    <td>
                      <div className="c-name">
                        {displayName(c)}
                        {pr > 0 && <span className="badge-prior" title={`Appeared in ${pr} previous run(s)`}>re-applicant ×{pr}</span>}
                        {c.duplicate_group && <span className="badge-dup" title="Looks like the same person as another candidate">dup?</span>}
                        {(c.confidence ?? 1) < 0.6 && <span className="badge-warn" title="Low resume-structure confidence">check</span>}
                      </div>
                      {!anon && <div className="c-sub" title={c.brief?.headline || c.filename}>{c.brief?.headline || c.filename}</div>}
                    </td>
                    {!anon && <td className="c-mono" title={c.email}>{c.email || "—"}</td>}
                    {!anon && <td className="c-mono hide-md" title={c.phone}>{c.phone || "—"}</td>}
                    <td className="c-exp">{c.experience_years}y</td>
                    <td className="c-score"><div className="score-cell"><span className={`score-num ${scoreClass(c.score)}`}>{c.score}</span><div className="score-bar"><div className={`score-fill ${scoreClass(c.score)}`} style={{ width: `${c.score}%` }} /></div></div></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select className={`status-select st-${status}`} value={status} onChange={(e) => setStatus(c, e.target.value as ReviewStatus)} aria-label={`Status for ${displayName(c)}`}>
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "heatmap" && (
        <div className="table-wrap heat-wrap">
          <table className="heat">
            <thead><tr><th className="heat-name">Candidate</th><th>Score</th>{units.map((u) => <th key={u.label} className="heat-col"><span>{u.label}</span></th>)}</tr></thead>
            <tbody>
              {rows.map((c, idx) => {
                const m = new Set(c.matched_skills);
                return (
                  <tr key={c.rank} className="row" onClick={() => { setActive(idx); setDrawerIdx(idx); }}>
                    <td className="heat-name"><span className={`rank-badge ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span> {displayName(c)}</td>
                    <td><span className={`score-num ${scoreClass(c.score)}`}>{c.score}</span></td>
                    {units.map((u) => { const hit = u.members.some((s) => m.has(s)); return <td key={u.label} className={`heat-cell ${hit ? "hit" : "miss"}`} title={`${u.label}: ${hit ? "matched" : "missing"}`}>{hit ? "●" : ""}</td>; })}
                  </tr>
                );
              })}
              <tr className="heat-total"><td className="heat-name">Coverage</td><td></td>
                {units.map((u) => { const n = rows.filter((c) => u.members.some((s) => c.matched_skills.includes(s))).length; const pct = rows.length ? Math.round((n / rows.length) * 100) : 0; return <td key={u.label} className={`heat-cell pct ${pct < 34 ? "rare" : ""}`} title={`${n}/${rows.length} candidates`}>{pct}%</td>; })}
              </tr>
            </tbody>
          </table>
          <p className="hint">Low-coverage columns are skills almost nobody has — consider whether they're truly must-haves. Click a row for details.</p>
        </div>
      )}

      {view === "board" && <Board cands={rows} statusOf={statusOf} anon={anon} onMove={(c, s) => setStatus(c, s, true)} onOpen={(c) => { const i = rows.indexOf(c); setActive(i); setDrawerIdx(i); }} />}

      {flagged.length > 0 && (
        <div className="flagged"><h3>Excluded — didn't look like a resume</h3>
          <ul>{flagged.map((f) => <li key={f.filename}><b>{f.filename}</b><span className="muted"> · confidence {Math.round(f.confidence * 100)}% · {f.reasons.join(", ")}</span></li>)}</ul></div>
      )}
      {data.errors.length > 0 && <div className="errors">{data.errors.map((e) => <div key={e.filename} className="err-line">{e.filename}: {e.error}</div>)}</div>}

      <AnimatePresence>
        {drawerCand && (
          <CandidateDrawer key={candidateKey(drawerCand) + drawerCand.rank}
            c={drawerCand} index={drawerIdx!} total={rows.length} anon={anon} review={reviewOf(drawerCand)}
            prior={prior.get((drawerCand.email || "").toLowerCase()) ?? 0}
            canEmail={!!canSend && !!drawerCand.email} canView={fileMap.has(drawerCand.filename)}
            onClose={() => setDrawerIdx(null)}
            onPrev={() => setDrawerIdx((i) => (i !== null && i > 0 ? i - 1 : i))}
            onNext={() => setDrawerIdx((i) => (i !== null && i < rows.length - 1 ? i + 1 : i))}
            onStatus={(s) => setStatus(drawerCand, s)} onNotes={(n) => saveNotes(drawerCand, n)}
            onEmail={() => setEmailTo(drawerCand)} onView={() => openResume(drawerCand)} />
        )}
      </AnimatePresence>

      {createPortal(<AnimatePresence>
        {compare && selectedCands.length >= 2 && (
          <div className="modal-scrim" onClick={() => setCompare(false)}>
            <motion.div className="modal compare" onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} role="dialog" aria-modal="true" aria-label="Compare candidates">
              <div className="panel">
                <div className="panel-head"><h2>Compare candidates</h2><button className="btn btn-ghost sm" onClick={() => setCompare(false)}>Close</button></div>
                <div className="cmp-grid" style={{ gridTemplateColumns: `160px repeat(${selectedCands.length}, 1fr)` }}>
                  <div className="cmp-h"></div>
                  {selectedCands.map((c) => <div key={c.rank} className="cmp-h"><div className="c-name">{displayName(c)}</div><span className={`score-num ${scoreClass(c.score)}`}>{c.score}</span></div>)}
                  <div className="cmp-l">Experience</div>{selectedCands.map((c) => <div key={c.rank}>{c.experience_years} yrs</div>)}
                  {Object.keys(selectedCands[0].breakdown).map((k) => <CmpRow key={k} label={k} cands={selectedCands} k={k} />)}
                  <div className="cmp-l">Matched</div>{selectedCands.map((c) => <div key={c.rank} className="tags">{c.matched_skills.map((s) => <span key={s} className="tag matched">{s}</span>)}</div>)}
                  <div className="cmp-l">Missing</div>{selectedCands.map((c) => <div key={c.rank} className="tags">{c.missing_skills.map((s) => <span key={s} className="tag missing">{s}</span>)}</div>)}
                  <div className="cmp-l">Brief</div>{selectedCands.map((c) => <div key={c.rank} className="muted small">{c.brief?.headline}</div>)}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>, document.body)}

      {emailTo && createPortal(<EmailModal c={emailTo} jobTitle={data.job.title} onClose={() => setEmailTo(null)} onSent={() => setEmailTo(null)} />, document.body)}

      {viewFile && createPortal(
        <div className="modal-scrim" onClick={() => { URL.revokeObjectURL(viewFile.url); setViewFile(null); }}>
          <div className="modal viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Resume preview">
            <div className="viewer-head"><span>{viewFile.name}</span><button className="btn btn-ghost sm" onClick={() => { URL.revokeObjectURL(viewFile.url); setViewFile(null); }}>Close</button></div>
            {viewFile.name.toLowerCase().endsWith(".pdf") ? <iframe title="resume" src={viewFile.url} className="viewer-frame" /> : <p className="muted" style={{ padding: 20 }}>Inline preview is available for PDFs. <a href={viewFile.url} download={viewFile.name}>Download {viewFile.name}</a></p>}
          </div>
        </div>, document.body)}
    </motion.section>
  );
}

function CmpRow({ label, cands, k }: { label: string; cands: Candidate[]; k: string }) {
  return (<>
    <div className="cmp-l cap">{label}</div>
    {cands.map((c) => { const v = c.breakdown[k]; return (
      <div key={c.rank}><div className="bd-head"><span></span><span className="bd-val">{v?.score ?? 0}/{v?.max ?? 0}</span></div><div className="bd-track"><div className="bd-fill" style={{ width: `${v ? (v.score / v.max) * 100 : 0}%` }} /></div></div>
    ); })}
  </>);
}

function Board({ cands, statusOf, anon, onMove, onOpen }: { cands: Candidate[]; statusOf: (c: Candidate) => ReviewStatus; anon: boolean; onMove: (c: Candidate, s: ReviewStatus) => void; onOpen: (c: Candidate) => void }) {
  const [drag, setDrag] = useState<Candidate | null>(null);
  return (
    <div className="board">
      {STATUSES.map((s) => (
        <div key={s} className={`col st-${s}`} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) onMove(drag, s); setDrag(null); }}>
          <div className="col-head">{STATUS_LABEL[s]} <span>{cands.filter((c) => statusOf(c) === s).length}</span></div>
          {cands.filter((c) => statusOf(c) === s).map((c) => (
            <div key={c.rank} className="card-mini" draggable onDragStart={() => setDrag(c)} onClick={() => onOpen(c)}>
              <div className="cm-top"><span className={`rank-badge ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span><span className={`score-num ${scoreClass(c.score)}`}>{c.score}</span></div>
              <div className="c-name">{anon ? `Candidate #${c.rank}` : c.name}</div>
              <div className="c-sub">{c.experience_years}y · {c.matched_skills.slice(0, 3).join(", ")}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function EmailModal({ c, jobTitle, onClose, onSent }: { c: Candidate; jobTitle: string; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const first = c.name.split(" ")[0] || "there";
  const templates = {
    ack: { subject: `Application received — ${jobTitle || "your application"}`, body: `Hi ${first},\n\nThank you for applying for the ${jobTitle || "role"}. We've received your application and are reviewing it. We'll be in touch with next steps soon.\n\nBest regards` },
    interview: { subject: `Interview invitation — ${jobTitle || "role"}`, body: `Hi ${first},\n\nWe enjoyed reviewing your profile and would like to invite you to an interview for the ${jobTitle || "role"}. Could you share a few times that work for you this week or next?\n\nBest regards` },
    reject: { subject: `Update on your application — ${jobTitle || "role"}`, body: `Hi ${first},\n\nThank you for taking the time to apply for the ${jobTitle || "role"}. After careful review we've decided to move forward with other candidates at this time. We appreciate your interest and wish you the best in your search.\n\nBest regards` },
  };
  const [tpl, setTpl] = useState<keyof typeof templates>("ack");
  const [subject, setSubject] = useState(templates.ack.subject);
  const [body, setBody] = useState(templates.ack.body);
  const [busy, setBusy] = useState(false);
  function pick(k: keyof typeof templates) { setTpl(k); setSubject(templates[k].subject); setBody(templates[k].body); }
  async function send() {
    setBusy(true);
    const id = toast.loading(`Sending to ${c.email}…`);
    try { await gmailSend(c.email, subject, body); toast.update(id, "success", `Email sent to ${c.name}.`); onSent(); }
    catch (e) { toast.update(id, "error", `Send failed: ${msg(e)}`, 7000); }
    finally { setBusy(false); }
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal email" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Email candidate">
        <div className="panel">
          <div className="panel-head"><h2>Email {c.name}</h2><button className="btn btn-ghost sm" onClick={onClose}>Close</button></div>
          <div className="segmented small" style={{ marginBottom: 14 }}>
            <button className={tpl === "ack" ? "seg on" : "seg"} onClick={() => pick("ack")}>Acknowledge</button>
            <button className={tpl === "interview" ? "seg on" : "seg"} onClick={() => pick("interview")}>Invite to interview</button>
            <button className={tpl === "reject" ? "seg on" : "seg"} onClick={() => pick("reject")}>Decline</button>
          </div>
          <div className="field"><label className="field-label">To</label><input className="input" value={c.email} disabled /></div>
          <div className="field"><label className="field-label">Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="field"><label className="field-label">Message</label><textarea className="input textarea" rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></div>
          <div className="head-actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={send} disabled={busy || !subject.trim() || !body.trim()}><Send size={14} /> {busy ? "Sending…" : "Send via Gmail"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function emptyReview(runId: string, key: string, c: Candidate): Review {
  return { run_id: runId, candidate_key: key, candidate_name: c.name, candidate_email: c.email, status: "new", notes: "" };
}
function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
