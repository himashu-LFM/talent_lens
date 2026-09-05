/* Shortlist — the results workspace for the active run. Filters live in the
   context sidebar; the table / heatmap / pipeline views are in <Results>. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, ListOrdered, Search } from "lucide-react";
import Results, { requirementUnits } from "../components/Results";
import { EmptyState } from "../components/ui";
import { Eyebrow } from "../components/ds";
import { useToast } from "../components/Toast";
import { Sidebar, useWorkspace } from "../context/Workspace";
import { useAuth } from "../auth/AuthProvider";
import { exportExcel, type ExportCandidate } from "../api";
import { STATUSES, type ReviewStatus } from "../lib/db";

const STATUS_LABEL: Record<ReviewStatus, string> = { new: "New", shortlisted: "Shortlisted", interview: "Interview", rejected: "Rejected", hired: "Hired" };
const DOT: Record<ReviewStatus, string> = { new: "var(--faint)", shortlisted: "var(--amber-400)", interview: "var(--blue-400)", rejected: "var(--red-400)", hired: "var(--emerald-400)" };

export default function Shortlist() {
  const nav = useNavigate();
  const toast = useToast();
  const { run, filters, setFilters, ready } = useWorkspace();
  const { configured, user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [counts, setCounts] = useState<Record<ReviewStatus, number>>({ new: 0, shortlisted: 0, interview: 0, rejected: 0, hired: 0 });

  const units = useMemo(() => (run ? requirementUnits(run.data) : []), [run]);

  async function doExport(rows: ExportCandidate[]) {
    if (!run) return;
    setExporting(true);
    const id = toast.loading("Building Excel file…");
    try { await exportExcel(rows, run.data.job.title || run.title); toast.update(id, "success", `Exported ${rows.length} candidate(s).`); }
    catch (e) { toast.update(id, "error", `Export failed: ${e instanceof Error ? e.message : ""}`, 6000); }
    finally { setExporting(false); }
  }

  if (!run) {
    return (
      <div className="page">
        <EmptyState icon={<ListOrdered size={26} />} title="No shortlist yet"
          body="Describe a role, add resumes and run a screening — the ranked shortlist with evidence appears here. You can also re-open any past run from History."
          action={<><button className="btn btn-primary" onClick={() => nav("/")}>Start a screening run</button><button className="btn btn-ghost" onClick={() => nav("/history")}>Open history</button></>} />
      </div>
    );
  }

  const total = run.data.top.length;
  return (
    <div className="page">
      <Sidebar>
        <div>
          <Eyebrow>Filter</Eyebrow>
          <div className="input-ico">
            <Search size={15} />
            <input className="input" placeholder="Name, email, skill…" value={filters.query} onChange={(e) => setFilters({ query: e.target.value })} aria-label="Filter candidates" />
          </div>
        </div>
        <div className="ctx-range">
          <div className="l"><span>Minimum score</span><b>{filters.minScore}</b></div>
          <input type="range" className="range" min={0} max={100} value={filters.minScore} onChange={(e) => setFilters({ minScore: Number(e.target.value) })} aria-label="Minimum score" />
        </div>
        <div>
          <Eyebrow>Pipeline</Eyebrow>
          <div className="ctx-list">
            <button className={`ctx-item ${filters.status === "all" ? "on" : ""}`} onClick={() => setFilters({ status: "all" })}><span>All candidates</span><b>{total}</b></button>
            {STATUSES.filter((s) => s !== "new").map((s) => (
              <button key={s} className={`ctx-item ${filters.status === s ? "on" : ""}`} onClick={() => setFilters({ status: filters.status === s ? "all" : s })}>
                <span className="lab"><i style={{ background: DOT[s] }} />{STATUS_LABEL[s]}</span><b>{counts[s]}</b>
              </button>
            ))}
          </div>
        </div>
        {units.length > 0 && (
          <div>
            <Eyebrow>Requirements</Eyebrow>
            <div className="chips">{units.map((u) => <span key={u.label} className={`chip ${u.members.length > 1 ? "dashed" : ""}`} title={u.members.length > 1 ? "Either alternative satisfies this requirement" : undefined}>{u.label}</span>)}</div>
          </div>
        )}
        <label className="ctx-check">
          <input type="checkbox" className="check" checked={filters.anon} onChange={(e) => setFilters({ anon: e.target.checked })} />
          Anonymized review
        </label>
        {run.runId && configured && user && <div className="notice small"><b>Saved to history.</b> Statuses and notes persist for this run.</div>}
        {!run.runId && configured && user && run.source !== "history" && <div className="notice small">Statuses will save once the run finishes writing to history.</div>}
      </Sidebar>

      <Results
        data={run.data} runId={run.runId} files={run.files} canSend={!!ready?.gmail_can_send}
        onExport={doExport} exporting={exporting} onCounts={setCounts}
        exportIcon={<Download size={14} />}
      />
    </div>
  );
}
