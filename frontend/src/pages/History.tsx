import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Inbox, Mail, Trash2, Trophy, Upload, Zap } from "lucide-react";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState, SkeletonCard } from "../components/ui";
import { scoreClass } from "../components/ds";
import { useWorkspace } from "../context/Workspace";
import { listRuns, deleteRun, type RunRow } from "../lib/db";
import { exportExcel } from "../api";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
const SRC = { gmail: { label: "Gmail", Icon: Mail }, upload: { label: "Upload", Icon: Upload }, auto: { label: "Auto", Icon: Zap } } as const;

export default function History() {
  const toast = useToast();
  const nav = useNavigate();
  const { configured } = useAuth();
  const { setRun, resetFilters, run, orgId } = useWorkspace();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    listRuns(orgId || undefined)
      .then((rs) => {
        setRuns(rs);
        const want = new URLSearchParams(window.location.search).get("run");
        if (want) { const r = rs.find((x) => x.id === want); if (r) openRun(r); }
      })
      .catch((e) => toast.error(`Couldn't load history: ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openRun(r: RunRow) {
    resetFilters();
    setRun({
      data: r.results, runId: r.id, files: [], title: r.title,
      source: "history", jobId: r.job_id ?? null, at: r.created_at,
    });
    nav("/shortlist");
  }
  async function remove(id: string) {
    try {
      await deleteRun(id);
      setRuns((r) => r.filter((x) => x.id !== id));
      if (run?.runId === id) setRun(null);
      toast.success("Run deleted.");
    } catch (e) { toast.error(`Delete failed: ${e instanceof Error ? e.message : ""}`); }
  }
  async function exportRun(r: RunRow) {
    setExporting(true);
    try { await exportExcel(r.results.top, r.title); } catch { toast.error("Export failed."); } finally { setExporting(false); }
  }

  if (!configured) return <div className="page"><EmptyState icon={<Inbox size={26} />} title="History isn't set up yet" body={<>Add your Supabase keys to <code>frontend/.env</code> and reload to start saving runs.</>} /></div>;
  if (loading) return <div className="page run-grid">{[0, 1, 2].map((i) => <SkeletonCard key={i} lines={4} />)}</div>;
  if (runs.length === 0) return <div className="page"><EmptyState icon={<Inbox size={26} />} title="No runs yet" body="Screen some resumes and they'll show up here, re-openable with their statuses and notes." action={<button className="btn btn-primary" onClick={() => nav("/")}>Start a screening run</button>} /></div>;

  return (
    <div className="page run-grid">
      {runs.map((r) => {
        const s = SRC[r.source as keyof typeof SRC] ?? SRC.upload;
        const isCurrent = run?.runId === r.id;
        return (
          <article key={r.id} className={`run-card card-hover ${r.source}`}>
            <div className="run-top">
              <span className={`src-tag ${r.source}`}><s.Icon size={11} /> {s.label}</span>
              <span className="run-date">{when(r.created_at)}</span>
            </div>
            <h3 title={r.title}>{r.title}</h3>
            <div className="metrics">
              <span><b>{r.total_resumes}</b><small>screened</small></span>
              <span><b>{r.shortlisted}</b><small>shortlisted</small></span>
              <span><b className="amber">{Number(r.avg_score).toFixed(1)}</b><small>avg score</small></span>
            </div>
            {r.top_name && <div className="run-top-cand"><Trophy size={14} /><span title={r.top_name}>{r.top_name}</span><b className={`sc-${scoreClass(r.top_score ?? 0)}`}>{r.top_score}</b></div>}
            <div className="run-actions">
              <button className={`btn sm ${isCurrent ? "btn-grad" : "btn-ghost"}`} onClick={() => openRun(r)}>{isCurrent ? "Open run · current" : "Open run"}</button>
              <button className="btn btn-ghost sm icon-only" onClick={() => exportRun(r)} disabled={exporting} aria-label="Export to Excel" title="Export to Excel"><Download size={14} /></button>
              <button className="btn btn-ghost sm icon-only danger" onClick={() => remove(r.id)} aria-label="Delete run" title="Delete run"><Trash2 size={14} /></button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
