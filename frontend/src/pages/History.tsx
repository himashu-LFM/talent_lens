import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthProvider";
import Results from "../components/Results";
import { listRuns, deleteRun, type RunRow } from "../lib/db";
import { exportExcel } from "../api";

function timeAgo(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

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
      .then(setRuns)
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
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : ""}`);
    }
  }

  async function exportRun(run: RunRow) {
    setExporting(true);
    try {
      await exportExcel(run.results.top);
    } catch {
      toast.error("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Screening history</h1>
        <p>Every run you’ve completed, saved to your account.</p>
      </div>

      {!configured ? (
        <div className="panel empty">
          <div className="empty-emoji">🗂️</div>
          <h3>History isn’t set up yet</h3>
          <p>Add your Supabase keys to <code>frontend/.env</code> and reload to start saving runs.</p>
        </div>
      ) : loading ? (
        <div className="panel empty"><p className="muted">Loading…</p></div>
      ) : runs.length === 0 ? (
        <div className="panel empty">
          <div className="empty-emoji">📭</div>
          <h3>No runs yet</h3>
          <p>Screen some resumes on the dashboard and they’ll show up here.</p>
        </div>
      ) : (
        <div className="run-grid">
          {runs.map((r, i) => (
            <motion.div
              key={r.id}
              className="run-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <div className="run-top">
                <span className={`src-tag ${r.source}`}>{r.source === "gmail" ? "Gmail" : "Upload"}</span>
                <span className="run-date">{timeAgo(r.created_at)}</span>
              </div>
              <h3 className="run-title">{r.title}</h3>
              <div className="run-metrics">
                <div><b>{r.total_resumes}</b><span>screened</span></div>
                <div><b>{r.shortlisted}</b><span>shortlisted</span></div>
                <div><b className="accent">{r.avg_score}</b><span>avg score</span></div>
              </div>
              {r.top_name && (
                <div className="run-top-cand">
                  🥇 {r.top_name} · <b>{r.top_score}</b>
                </div>
              )}
              <div className="run-actions">
                <button className="btn btn-ghost sm" onClick={() => setOpen(r)}>View</button>
                <button className="btn btn-ghost sm" onClick={() => exportRun(r)} disabled={exporting}>Export</button>
                <button className="btn btn-ghost sm danger" onClick={() => remove(r.id)}>Delete</button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {open && (
        <div className="modal-scrim" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setOpen(null)}>×</button>
            <Results data={open.results} onExport={() => exportRun(open)} exporting={exporting} />
          </div>
        </div>
      )}
    </main>
  );
}
