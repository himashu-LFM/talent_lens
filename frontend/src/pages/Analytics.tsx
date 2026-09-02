import { useEffect, useMemo, useState } from "react";
import { BarChart3, LineChart as LineIcon, Table2 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { EmptyState, Num, SkeletonCard } from "../components/ui";
import { listAllReviews, listRuns, type Review, type RunRow } from "../lib/db";
import type { Candidate } from "../api";

/* Single-hue charts (gold) — identity is carried by axis labels, not color.
   Recessive grid, thin marks, rounded data-ends, hover tooltips, table view. */

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function weekKey(iso: string) {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // Monday start
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

interface Tip { x: number; y: number; label: string; value: string }

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  return { tip, setTip };
}

function Bars({ data, height = 180, valueFmt = (v: number) => String(v) }: {
  data: { label: string; value: number }[]; height?: number; valueFmt?: (v: number) => string;
}) {
  const { tip, setTip } = useTip();
  const W = 640, H = height, padL = 34, padB = 28, padT = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const slot = (W - padL) / n;
  const bw = Math.max(6, Math.min(36, slot - 2)); // 2px surface gap
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => {
          const y = padT + (H - padT - padB) * (1 - t / max);
          return <g key={t}><line x1={padL} x2={W} y1={y} y2={y} className="grid" /><text x={padL - 6} y={y + 4} className="axis" textAnchor="end">{t}</text></g>;
        })}
        {data.map((d, i) => {
          const h = (H - padT - padB) * (d.value / max);
          const x = padL + i * slot + (slot - bw) / 2;
          const y = H - padB - h;
          return (
            <g key={d.label} onMouseEnter={() => setTip({ x: x + bw / 2, y, label: d.label, value: valueFmt(d.value) })}>
              <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              <rect x={x} y={y} width={bw} height={Math.max(h, 0)} rx={h > 4 ? 4 : 0} className="mark" />
              {n <= 12 && <text x={x + bw / 2} y={H - padB + 16} className="axis" textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} className="baseline" />
      </svg>
      {tip && <div className="tip" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}><b>{tip.value}</b><span>{tip.label}</span></div>}
    </div>
  );
}

function HBars({ data, valueFmt = (v: number) => String(v) }: { data: { label: string; value: number }[]; valueFmt?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hbars">
      {data.map((d) => (
        <div key={d.label} className="hbar" title={`${d.label}: ${valueFmt(d.value)}`}>
          <span className="hbar-label">{d.label}</span>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(d.value / max) * 100}%` }} /></div>
          <span className="hbar-val">{valueFmt(d.value)}</span>
        </div>
      ))}
      {data.length === 0 && <p className="muted small">No data yet.</p>}
    </div>
  );
}

function LineChart({ points, height = 180 }: { points: { label: string; value: number }[]; height?: number }) {
  const { tip, setTip } = useTip();
  const W = 640, H = height, padL = 34, padB = 28, padT = 10;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? padL + (W - padL) / 2 : padL + (i * (W - padL - 12)) / (n - 1) + 6);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / 100);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" onMouseLeave={() => setTip(null)}>
        {[0, 50, 100].map((t) => <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">{t}</text></g>)}
        {n > 0 && <path d={path} className="line" />}
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setTip({ x: x(i), y: y(p.value), label: p.label, value: `${p.value} avg` })}>
            <rect x={x(i) - (W - padL) / (2 * Math.max(n, 1))} y={padT} width={(W - padL) / Math.max(n, 1)} height={H - padT - padB} fill="transparent" />
            <circle cx={x(i)} cy={y(p.value)} r={4} className="marker" />
          </g>
        ))}
        {tip && <line x1={tip.x} x2={tip.x} y1={padT} y2={H - padB} className="crosshair" />}
      </svg>
      {tip && <div className="tip" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}><b>{tip.value}</b><span>{tip.label}</span></div>}
      {n === 0 && <p className="muted small">No runs yet.</p>}
    </div>
  );
}

export default function Analytics() {
  const { configured } = useAuth();
  const toast = useToast();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [table, setTable] = useState(false);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    Promise.all([listRuns(), listAllReviews()])
      .then(([r, rv]) => { setRuns(r); setReviews(rv); })
      .catch((e) => toast.error(`Couldn't load analytics: ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const m = useMemo(() => {
    const chrono = [...runs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const screened = runs.reduce((s, r) => s + r.total_resumes, 0);
    const shortlisted = runs.reduce((s, r) => s + r.shortlisted, 0);
    const avg = runs.length ? Math.round((runs.reduce((s, r) => s + Number(r.avg_score), 0) / runs.length) * 10) / 10 : 0;

    const byWeek = new Map<string, number>();
    chrono.forEach((r) => { const k = weekKey(r.created_at); byWeek.set(k, (byWeek.get(k) ?? 0) + r.total_resumes); });
    const weeks = Array.from(byWeek.entries()).slice(-12).map(([k, v]) => ({ label: fmtDate(k), value: v }));

    const trend = chrono.slice(-20).map((r) => ({ label: `${fmtDate(r.created_at)} · ${r.title}`, value: Number(r.avg_score) }));

    const bySource = new Map<string, number>();
    runs.forEach((r) => bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.total_resumes));
    const sources = Array.from(bySource.entries()).map(([k, v]) => ({ label: k === "gmail" ? "Gmail" : k === "auto" ? "Auto-screen" : "Upload", value: v }));

    const missing = new Map<string, number>();
    let candCount = 0;
    runs.forEach((r) => (r.results?.ranked ?? []).forEach((c: Candidate) => { candCount++; c.missing_skills.forEach((s) => missing.set(s, (missing.get(s) ?? 0) + 1)); }));
    const topMissing = Array.from(missing.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ label: k, value: v }));

    const statusCount: Record<string, number> = { shortlisted: 0, interview: 0, hired: 0, rejected: 0 };
    reviews.forEach((r) => { if (r.status in statusCount) statusCount[r.status]++; });
    const funnel = [
      { label: "Screened", value: candCount },
      { label: "Shortlisted", value: statusCount.shortlisted + statusCount.interview + statusCount.hired },
      { label: "Interview", value: statusCount.interview + statusCount.hired },
      { label: "Hired", value: statusCount.hired },
    ];
    const hireRate = candCount ? Math.round((statusCount.hired / candCount) * 1000) / 10 : 0;
    return { screened, shortlisted, avg, weeks, trend, sources, topMissing, funnel, hireRate, rejected: statusCount.rejected, candCount };
  }, [runs, reviews]);

  if (!configured) {
    return <main className="page"><div className="page-head"><h1><BarChart3 size={26} className="h-ico" /> Analytics</h1></div><EmptyState icon={<LineIcon size={30} />} title="Analytics needs history" body={<>Add Supabase keys to <code>frontend/.env</code>.</>} /></main>;
  }

  return (
    <main className="page">
      <div className="page-head row-head">
        <div><h1><BarChart3 size={26} className="h-ico" /> Analytics</h1><p>Your screening funnel, trends and skill gaps across {runs.length} run{runs.length === 1 ? "" : "s"}.</p></div>
        <label className={`pill-toggle ${table ? "on" : ""}`}><input type="checkbox" checked={table} onChange={(e) => setTable(e.target.checked)} /><Table2 size={14} /><span>{table ? "Showing tables" : "Show as tables"}</span></label>
      </div>

      {loading ? (
        <><div className="stats kpis">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="stat"><SkeletonCard lines={1} /></div>)}</div><div className="charts"><SkeletonCard lines={5} /><SkeletonCard lines={5} /></div></>
      ) : runs.length === 0 ? (
        <EmptyState icon={<BarChart3 size={30} />} title="No data yet" body="Run a few screenings and your funnel, trends and skill gaps will appear here." />
      ) : (
        <>
          <div className="stats kpis">
            <div className="stat"><div className="stat-num"><Num value={runs.length} /></div><div className="stat-label">Screening runs</div></div>
            <div className="stat"><div className="stat-num"><Num value={m.screened} /></div><div className="stat-label">Resumes screened</div></div>
            <div className="stat"><div className="stat-num"><Num value={m.shortlisted} /></div><div className="stat-label">Shortlisted (top-N)</div></div>
            <div className="stat"><div className="stat-num accent"><Num value={m.avg} decimals={1} /></div><div className="stat-label">Avg shortlist score</div></div>
            <div className="stat"><div className="stat-num"><Num value={m.hireRate} decimals={1} />%</div><div className="stat-label">Hire rate · {m.rejected} rejected</div></div>
          </div>

          <div className="charts">
            <section className="panel">
              <div className="panel-head tight"><h3>Applications screened per week</h3></div>
              {table ? <DataTable rows={m.weeks} /> : <Bars data={m.weeks} />}
            </section>
            <section className="panel">
              <div className="panel-head tight"><h3>Average shortlist score per run</h3></div>
              {table ? <DataTable rows={m.trend} /> : <LineChart points={m.trend} />}
            </section>
            <section className="panel">
              <div className="panel-head tight"><h3>Hiring funnel</h3></div>
              {table ? <DataTable rows={m.funnel} /> : <Bars data={m.funnel} />}
              <p className="hint">Based on statuses you've set. Screened = all candidates ranked across runs.</p>
            </section>
            <section className="panel">
              <div className="panel-head tight"><h3>Most-missing requirements</h3></div>
              {table ? <DataTable rows={m.topMissing} /> : <HBars data={m.topMissing} valueFmt={(v) => `${v} cand.`} />}
              <p className="hint">Skills applicants most often lack — candidates for "nice to have", or a sourcing gap.</p>
            </section>
            <section className="panel">
              <div className="panel-head tight"><h3>Resumes by source</h3></div>
              {table ? <DataTable rows={m.sources} /> : <HBars data={m.sources} />}
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function DataTable({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <div className="table-wrap">
      <table className="tbl small">
        <thead><tr><th>Label</th><th>Value</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="c-mono">{r.value}</td></tr>)}{rows.length === 0 && <tr><td colSpan={2} className="tbl-empty">No data</td></tr>}</tbody>
      </table>
    </div>
  );
}
