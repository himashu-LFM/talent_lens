/* Ranked results: table · requirements heatmap · pipeline board, with statuses, notes,
   bulk actions, compare, email, inline viewer and the candidate drawer. Filter state
   (query / min score / status / anonymize / view) comes from the Workspace context so
   the sidebar can drive it. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import { AlertTriangle, ChevronRight, Columns3, Download, Grid3X3, KanbanSquare, Printer, Send, Table2 } from "lucide-react";
import CandidateDrawer from "./CandidateDrawer";
import { Badge, SegTabs, scoreClass, statusVariant } from "./ds";
import type { Candidate, ExportCandidate, ScreenResponse } from "../api";
import { gmailSend } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace, type View } from "../context/Workspace";
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
  onCounts?: (c: Record<ReviewStatus, number>) => void;
  exportIcon?: ReactNode;
}

const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New", shortlisted: "Shortlisted", interview: "Interview", rejected: "Rejected", hired: "Hired",
};

export function requirementUnits(data: ScreenResponse): { label: string; members: string[] }[] {
  const groups = data.job.alternative_groups ?? [];
  const grouped = new Set(groups.flat());
  const units = data.job.required_skills.filter((s) => !grouped.has(s)).map((s) => ({ label: s, members: [s] }));
  groups.forEach((g) => units.push({ label: g.join(" or "), members: g }));
  (data.job.extra_requirements ?? []).forEach((s) => units.push({ label: s, members: [s] }));
  return units;
}

export default function Results({ data, runId, files, canSend, onExport, exporting, onCounts }: Props) {
  const toast = useToast();
  const { user, configured } = useAuth();
  const { filters, setFilters } = useWorkspace();
  const { query, minScore, status: statusFilter, anon, view, sort: sortKey } = filters;

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

  const counts = useMemo(() => STATUSES.reduce((acc, s) => ({ ...acc, [s]: data.top.filter((c) => statusOf(c) === s).length }), {} as Record<ReviewStatus, number>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, reviews]);
  useEffect(() => { onCounts?.(counts); }, [counts, onCounts]);

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
      else if (e.key === "a") setFilters({ anon: !anon });
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, active, view, reviews, drawerIdx, anon]);

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
  function open(idx: number) { setActive(idx); setDrawerIdx(idx); }

  const units = useMemo(() => requirementUnits(data), [data]);
  const flagged = data.flagged ?? [];
  const drawerCand = drawerIdx !== null ? rows[drawerIdx] : null;
  const tag = (c: Candidate) => {
    const pr = prior.get((c.email || "").toLowerCase()) ?? 0;
    if (pr > 0) return <span className="mini-tag" title={`Appeared in ${pr} previous run(s)`}>re-applicant ×{pr}</span>;
    if (c.duplicate_group) return <span className="mini-tag warn" title="Looks like the same person as another candidate">dup?</span>;
    if ((c.confidence ?? 1) < 0.6) return <span className="mini-tag danger" title="Low resume-structure confidence">check</span>;
    return null;
  };

  return (
    <section aria-label="Shortlist results">
      <div className="toolbar">
        <SegTabs<View> surface value={view} onChange={(v) => setFilters({ view: v })} items={[
          { value: "table", label: <><Table2 size={14} /> Table</> },
          { value: "heatmap", label: <><Grid3X3 size={14} /> Heatmap</> },
          { value: "board", label: <><KanbanSquare size={14} /> Pipeline</> },
        ]} />
        <select className="input" style={{ width: 150, height: 38, fontSize: 12.5 }} value={sortKey} onChange={(e) => setFilters({ sort: e.target.value as typeof sortKey })} aria-label="Sort">
          <option value="score">Sort: Score</option><option value="experience">Sort: Experience</option><option value="name">Sort: Name</option>
        </select>
        <div className="grow" />
        <span className="kbd-hint"><kbd>j</kbd> <kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>s</kbd> shortlist · <kbd>r</kbd> reject</span>
        <button className="btn btn-ghost sm" disabled={selectedCands.length < 2 || selectedCands.length > 3} onClick={() => setCompare(true)}><Columns3 size={14} /> Compare{selectedCands.length ? ` (${selectedCands.length})` : ""}</button>
        <button className="btn btn-ghost sm" onClick={() => window.print()} aria-label="Print"><Printer size={14} /></button>
        <button className="btn btn-ghost sm" onClick={doExport} disabled={exporting}><Download size={14} /> {exporting ? "Exporting…" : "Export"}</button>
      </div>

      <div className="bulkbar">
        <span>{selectedCands.length ? `${selectedCands.length} selected` : "Bulk actions"}</span>
        <button className="link-btn" onClick={() => setSelected(new Set(rows.map(candidateKey)))}>Select all filtered</button>
        {selectedCands.length > 0 && (<>
          <button className="btn btn-ghost sm" onClick={() => bulkStatus(selectedCands, "shortlisted")}>Shortlist selected</button>
          <button className="btn btn-ghost sm danger" onClick={() => bulkStatus(selectedCands, "rejected")}>Reject selected</button>
          <button className="link-btn muted" onClick={() => setSelected(new Set())}>Clear</button>
        </>)}
        <span className="grow" />
        <span className="sep" />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Shortlist everyone ≥ <input className="input num-input sm" type="number" min={0} max={100} value={bulkMin} onChange={(e) => setBulkMin(Number(e.target.value))} aria-label="Minimum score" /></label>
        <button className="btn btn-primary sm" onClick={() => bulkStatus(data.top.filter((c) => c.score >= bulkMin && statusOf(c) === "new"), "shortlisted")}>Apply</button>
      </div>

      {view === "table" && (
        <div className="tbl-card">
          <div className="tbl-grid tbl-head"><span /><span>#</span><span>Candidate</span><span>Match</span><span>Exp.</span><span>Requirements</span><span>Status</span><span /></div>
          {rows.length === 0 && <div className="tbl-empty">No candidates match these filters.</div>}
          {rows.map((c, idx) => {
            const st = statusOf(c);
            const sc = scoreClass(c.score);
            const m = new Set(c.matched_skills);
            return (
              <div key={candidateKey(c) + c.rank} role="button" tabIndex={0}
                className={`tbl-grid tbl-row st-${st} ${idx === active ? "active" : ""} ${drawerIdx === idx ? "open" : ""}`}
                onClick={() => open(idx)} onKeyDown={(e) => e.key === "Enter" && open(idx)}>
                <span className="check" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="check" checked={selected.has(candidateKey(c))} onChange={() => toggleSelect(c)} aria-label={`Select ${displayName(c)}`} /></span>
                <span><span className={`rank ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span></span>
                <span className="cand">
                  <span className="cand-name">{displayName(c)}{tag(c)}</span>
                  <span className="cand-head" title={anon ? undefined : c.brief?.headline || c.filename}>{anon ? "hidden in anonymized review" : c.brief?.headline || c.filename}</span>
                </span>
                <span className="score"><b className={`sc-${sc}`}>{c.score}</b><span className="score-bar"><span className={`bg-${sc}`} style={{ width: `${c.score}%` }} /></span></span>
                <span className="exp">{c.experience_years} yrs</span>
                <span className="dots">{units.map((u) => <span key={u.label} className={`dot ${u.members.some((s) => m.has(s)) ? "hit" : ""}`} title={`${u.label}: ${u.members.some((s) => m.has(s)) ? "matched" : "missing"}`} />)}</span>
                <span onClick={(e) => e.stopPropagation()}>
                  <StatusPicker value={st} onChange={(s) => setStatus(c, s)} label={`Status for ${displayName(c)}`} />
                </span>
                <span className="chev"><ChevronRight size={16} /></span>
              </div>
            );
          })}
        </div>
      )}

      {view === "heatmap" && (
        <div className="heat fade-in">
          <div className="heat-grid heat-head" style={{ gridTemplateColumns: `minmax(200px, 1.4fr) 70px repeat(${units.length}, minmax(58px, 1fr))` }}>
            <span>Candidate</span><span style={{ textAlign: "center" }}>Score</span>
            {units.map((u) => <span key={u.label} className="heat-vert" title={u.label}>{u.label}</span>)}
          </div>
          {rows.map((c, idx) => {
            const m = new Set(c.matched_skills);
            return (
              <div key={c.rank} className="heat-grid heat-row" style={{ gridTemplateColumns: `minmax(200px, 1.4fr) 70px repeat(${units.length}, minmax(58px, 1fr))` }} onClick={() => open(idx)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(idx)}>
                <span className="heat-name"><span className={`rank sm ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span>{displayName(c)}</span>
                <b className={`heat-score sc-${scoreClass(c.score)}`}>{c.score}</b>
                {units.map((u) => { const hit = u.members.some((s) => m.has(s)); return <span key={u.label} className={`heat-cell ${hit ? "hit" : ""}`} title={`${u.label}: ${hit ? "matched" : "missing"}`} />; })}
              </div>
            );
          })}
          <div className="heat-grid heat-total" style={{ gridTemplateColumns: `minmax(200px, 1.4fr) 70px repeat(${units.length}, minmax(58px, 1fr))` }}>
            <span>Coverage</span><span />
            {units.map((u) => { const n = rows.filter((c) => u.members.some((s) => c.matched_skills.includes(s))).length; const pct = rows.length ? Math.round((n / rows.length) * 100) : 0; return <span key={u.label} className={pct < 34 ? "rare" : ""} title={`${n}/${rows.length} candidates`}>{pct}%</span>; })}
          </div>
          <p>Columns in red are requirements almost nobody meets — worth checking whether they are truly must-haves.</p>
        </div>
      )}

      {view === "board" && (<>
        <Board cands={rows} statusOf={statusOf} anon={anon} onMove={(c, s) => setStatus(c, s, true)} onOpen={(c) => open(rows.indexOf(c))} />
        <p>Drag a card between columns to change a candidate's status.</p>
      </>)}

      {flagged.length > 0 && (
        <div className="notice-row">
          <AlertTriangle size={15} />
          <span><b>{flagged.length} file{flagged.length === 1 ? "" : "s"} excluded</b> — {flagged.slice(0, 3).map((f) => f.filename).join(", ")}{flagged.length > 3 ? ` and ${flagged.length - 3} more` : ""} didn't look like resumes.</span>
          <span className="grow" />
          <details style={{ fontSize: 12.5 }}><summary className="link-btn" style={{ cursor: "pointer", listStyle: "none" }}>Why?</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>{flagged.map((f) => <li key={f.filename}><b>{f.filename}</b> · confidence {Math.round(f.confidence * 100)}% · {f.reasons.join(", ")}</li>)}</ul>
          </details>
        </div>
      )}
      {data.errors.length > 0 && <div className="notice-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>{data.errors.map((e) => <div key={e.filename} className="err-line">{e.filename}: {e.error}</div>)}</div>}

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

      {compare && selectedCands.length >= 2 && createPortal(
        <div className="modal-scrim" onClick={() => setCompare(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Compare candidates">
            <div className="card-head"><h2>Compare candidates</h2><button className="btn btn-ghost sm" onClick={() => setCompare(false)}>Close</button></div>
            <div className="cmp-grid" style={{ gridTemplateColumns: `140px repeat(${selectedCands.length}, minmax(160px, 1fr))` }}>
              <div className="cmp-h" />
              {selectedCands.map((c) => <div key={c.rank} className="cmp-h"><div className="cand-name">{displayName(c)}</div><b className={`sc-${scoreClass(c.score)}`} style={{ fontSize: 22, fontWeight: 800 }}>{c.score}</b></div>)}
              <div className="cmp-l">Experience</div>{selectedCands.map((c) => <div key={c.rank}>{c.experience_years} yrs</div>)}
              {Object.keys(selectedCands[0].breakdown).map((k) => (<CmpRow key={k} label={k} cands={selectedCands} k={k} />))}
              <div className="cmp-l">Matched</div>{selectedCands.map((c) => <div key={c.rank} className="chips">{c.matched_skills.map((s) => <span key={s} className="chip matched">{s}</span>)}</div>)}
              <div className="cmp-l">Missing</div>{selectedCands.map((c) => <div key={c.rank} className="chips">{c.missing_skills.map((s) => <span key={s} className="chip missing">{s}</span>)}</div>)}
              <div className="cmp-l">Brief</div>{selectedCands.map((c) => <div key={c.rank} className="muted small">{c.brief?.headline}</div>)}
            </div>
          </div>
        </div>, document.body)}

      {emailTo && createPortal(<EmailModal c={emailTo} jobTitle={data.job.title} onClose={() => setEmailTo(null)} onSent={() => setEmailTo(null)} />, document.body)}

      {viewFile && createPortal(
        <div className="modal-scrim" onClick={() => { URL.revokeObjectURL(viewFile.url); setViewFile(null); }}>
          <div className="modal viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Resume preview">
            <div className="viewer-head"><span className="ellipsis">{viewFile.name}</span><button className="btn btn-ghost sm" onClick={() => { URL.revokeObjectURL(viewFile.url); setViewFile(null); }}>Close</button></div>
            {viewFile.name.toLowerCase().endsWith(".pdf") ? <iframe title="resume" src={viewFile.url} className="viewer-frame" /> : <p className="muted" style={{ padding: 20 }}>Inline preview is available for PDFs. <a href={viewFile.url} download={viewFile.name}>Download {viewFile.name}</a></p>}
          </div>
        </div>, document.body)}
    </section>
  );
}

function StatusPicker({ value, onChange, label }: { value: ReviewStatus; onChange: (s: ReviewStatus) => void; label: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <Badge variant={statusVariant(value)}>{STATUS_LABEL[value]} ▾</Badge>
      <select value={value} onChange={(e) => onChange(e.target.value as ReviewStatus)} aria-label={label}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
    </span>
  );
}

function CmpRow({ label, cands, k }: { label: string; cands: Candidate[]; k: string }) {
  return (<>
    <div className="cmp-l">{label}</div>
    {cands.map((c) => { const v = c.breakdown[k]; return (
      <div key={c.rank} className="bd"><div className="l"><span /><b>{v?.score ?? 0}/{v?.max ?? 0}</b></div><div className="track"><span style={{ width: `${v ? (v.score / v.max) * 100 : 0}%` }} /></div></div>
    ); })}
  </>);
}

function Board({ cands, statusOf, anon, onMove, onOpen }: { cands: Candidate[]; statusOf: (c: Candidate) => ReviewStatus; anon: boolean; onMove: (c: Candidate, s: ReviewStatus) => void; onOpen: (c: Candidate) => void }) {
  const [drag, setDrag] = useState<Candidate | null>(null);
  return (
    <div className="board fade-in">
      {STATUSES.map((s) => (
        <div key={s} className="board-col" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) onMove(drag, s); setDrag(null); }}>
          <div className={`board-col-head st-${s}-c`}><span>{STATUS_LABEL[s]}</span><b>{cands.filter((c) => statusOf(c) === s).length}</b></div>
          {cands.filter((c) => statusOf(c) === s).map((c) => (
            <div key={c.rank} className={`board-card acc-${s}`} draggable onDragStart={() => setDrag(c)} onClick={() => onOpen(c)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(c)}>
              <div className="top"><span className={`rank sm ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span><b className={`sc-${scoreClass(c.score)}`}>{c.score}</b></div>
              <div className="n">{anon ? `Candidate #${c.rank}` : c.name}</div>
              <div className="m">{c.experience_years}y · {c.matched_skills.slice(0, 3).join(", ") || "no matched requirements"}</div>
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
        <div className="card-head"><h2>Email {c.name}</h2><button className="btn btn-ghost sm" onClick={onClose}>Close</button></div>
        <div style={{ marginBottom: 14 }}>
          <SegTabs small value={tpl} onChange={pick} items={[{ value: "ack", label: "Acknowledge" }, { value: "interview", label: "Invite to interview" }, { value: "reject", label: "Decline" }]} />
        </div>
        <div className="field"><label className="field-label">To</label><input className="input" value={c.email} disabled /></div>
        <div className="field"><label className="field-label">Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label className="field-label">Message</label><textarea className="input textarea" rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={busy || !subject.trim() || !body.trim()}><Send size={14} /> {busy ? "Sending…" : "Send via Gmail"}</button>
        </div>
      </div>
    </div>
  );
}

function emptyReview(runId: string, key: string, c: Candidate): Review {
  return { run_id: runId, candidate_key: key, candidate_name: c.name, candidate_email: c.email, status: "new", notes: "" };
}
function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
