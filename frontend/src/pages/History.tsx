import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Download, Eye, History as HistoryIcon, Inbox, Mail, Trash2, Trophy, Upload, X, Zap } from "lucide-react";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import Results from "../components/Results";
import { EmptyState, SkeletonCard } from "../components/ui";
import { listRuns, deleteRun, type RunRow } from "../lib/db";
import { exportExcel, type ExportCandidate } from "../api";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
const SRC = { gmail: { label: "Gmail", Icon: Mail }, upload: { label: "Upload", Icon: Upload }, auto: { label: "Auto", Icon: Zap } } as const;

export default function History() {
  const toast = useToast();
  const { configured } = useAuth();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<RunRow | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    listRuns()
      .then((rs) => {
        setRuns(rs);
        const want = new URLSearchParams(window.location.search).get("run");
        if (want) { const r = rs.find((x) => x.id === want); if (r) setOpen(r); }
      })
      .catch((e) => toast.error(`Couldn't load history: ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(id: string) {
    try {
      await deleteRun(id);
      setRuns((r) => r.filter((x) => x.id !== id));
      if (open?.id === id) setOpen(null);
      toast.success("Run deleted.");
    } catch (e) { toast.error(`Delete failed: ${e instanceof Error ? e.message : ""}`); }
  }

  async function exportRun(run: RunRow, rows?: ExportCandidate[]) {
    setExporting(true);
    try { await exportExcel(rows ?? run.results.top, run.title); } catch { toast.error("Export failed."); } finally { setExporting(false); }
  }

  return (
    <main className="page">
      <div className="page-head"><h1><HistoryIcon size={26} className="h-ico" /> Screening history</h1><p>Every run you've completed, with its statuses and notes.</p></div>

      {!configured ? (
        <EmptyState icon={<Inbox size={30} />} title="History isn't set up yet" body={<>Add your Supabase keys to <code>frontend/.env</code> and reload to start saving runs.</>} />
      ) : loading ? (
        <div className="run-grid">{[0, 1, 2].map((i) => <SkeletonCard key={i} lines={4} />)}</div>
      ) : runs.length === 0 ? (
        <EmptyState icon={<Inbox size={30} />} title="No runs yet" body="Screen some resumes on the dashboard and they'll show up here." />
      ) : (
        <div className="run-grid">
          {runs.map((r, i) => {
            const s = SRC[(r.source as keyof typeof SRC)] ?? SRC.upload;
            return (
              <motion.article key={r.id} className="run-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }}>
                <div className="run-top">
                  <span className={`src-tag ${r.source}`}><s.Icon size={12} /> {s.label}</span>
                  <span className="run-date"><Calendar size={12} /> {when(r.created_at)}</span>
                </div>
                <h3 className="run-title" title={r.title}>{r.title}</h3>
                <div className="run-metrics">
                  <div><b>{r.total_resumes}</b><span>screened</span></div>
                  <div><b>{r.shortlisted}</b><span>shortlisted</span></div>
                  <div><b className="accent">{r.avg_score}</b><span>avg score</span></div>
                </div>
                {r.top_name && <div className="run-top-cand"><Trophy size={13} /> <span title={r.top_name}>{r.top_name}</span> <b>{r.top_score}</b></div>}
                <div className="run-actions">
                  <button className="btn btn-primary sm" onClick={() => setOpen(r)}><Eye size={14} /> View</button>
                  <button className="btn btn-ghost sm" onClick={() => exportRun(r)} disabled={exporting}><Download size={14} /> Export</button>
                  <button className="btn btn-ghost sm danger icon-only" onClick={() => remove(r.id)} title="Delete run"><Trash2 size={14} /></button>
                </div>
              </motion.article>
            );
          })}
        </div>
      )}

      {open && (
        <div className="modal-scrim" onClick={() => setOpen(null)}>
          <motion.div className="modal" onClick={(e) => e.stopPropagation()} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <button className="modal-x" onClick={() => setOpen(null)} aria-label="Close"><X size={20} /></button>
            <Results data={open.results} runId={open.id} onExport={(rows) => exportRun(open, rows)} exporting={exporting} />
          </motion.div>
        </div>
      )}
    </main>
  );
}
