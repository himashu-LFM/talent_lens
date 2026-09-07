/* Insights — tiles + four chart sections, all single-hue amber. Bars are CSS with a
   grow animation; the trend is an SVG line that draws in; funnel and gaps are bars. */
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { EmptyState, Num, SkeletonCard } from "../components/ui";
import { ProgressBar } from "../components/ds";
import { listAllReviews, listRuns, type Review, type RunRow } from "../lib/db";
import type { Candidate } from "../api";

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function weekKey(iso: string) {
  const d = new Date(iso); const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0);
  return d.toISOString();
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
    const weeks = Array.from(byWeek.entries()).slice(-8).map(([k, v]) => ({ label: fmtDate(k), value: v }));
    const trend = chrono.slice(-12).map((r) => ({ label: `${fmtDate(r.created_at)} · ${r.title}`, short: Number(r.avg_score).toFixed(1), value: Number(r.avg_score) }));
    const bySource = new Map<string, number>();
    runs.forEach((r) => bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.total_resumes));
    const sources = Array.from(bySource.entries()).map(([k, v]) => ({ label: k === "gmail" ? "Gmail" : k === "auto" ? "Auto-screen" : "Upload", value: v }));
    const missing = new Map<string, number>(); let candCount = 0;
    runs.forEach((r) => (r.results?.ranked ?? []).forEach((c: Candidate) => { candCount++; c.missing_skills.forEach((s) => missing.set(s, (missing.get(s) ?? 0) + 1)); }));
    const topMissing = Array.from(missing.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ label: k, value: v }));
    const sc: Record<string, number> = { shortlisted: 0, interview: 0, hired: 0, rejected: 0 };
    reviews.forEach((r) => { if (r.status in sc) sc[r.status]++; });
    const funnel = [
      { label: "Screened", value: candCount, tone: "mixed" as const },
      { label: "Shortlisted", value: sc.shortlisted + sc.interview + sc.hired, tone: "amber" as const },
      { label: "Interview", value: sc.interview + sc.hired, tone: "amber" as const },
      { label: "Hired", value: sc.hired, tone: "emerald" as const },
    ];
    const hireRate = candCount ? Math.round((sc.hired / candCount) * 1000) / 10 : 0;
    return { screened, shortlisted, avg, weeks, trend, sources, topMissing, funnel, hireRate, candCount };
  }, [runs, reviews]);

  if (!configured) return <div className="page"><EmptyState icon={<BarChart3 size={26} />} title="Insights need history" body={<>Add Supabase keys to <code>frontend/.env</code>.</>} /></div>;
  if (loading) return <div className="page stack"><div className="tiles-5">{[0, 1, 2, 3, 4].map((i) => <SkeletonCard key={i} lines={1} />)}</div><div className="charts-2"><SkeletonCard lines={5} /><SkeletonCard lines={5} /></div></div>;
  if (runs.length === 0) return <div className="page"><EmptyState icon={<BarChart3 size={26} />} title="No data yet" body="Run a few screenings and your funnel, trends and skill gaps will appear here." /></div>;

  const weekMax = Math.max(1, ...m.weeks.map((w) => w.value));
  const funnelMax = Math.max(1, m.funnel[0].value);
  const missMax = Math.max(1, ...m.topMissing.map((x) => x.value));

  return (
    <div className="page stack">
      <div className="tiles-5">
        <div className="tile"><div className="tile-num"><Num value={runs.length} /></div><div className="tile-label">Screening runs</div></div>
        <div className="tile"><div className="tile-num"><Num value={m.screened} /></div><div className="tile-label">Resumes screened</div></div>
        <div className="tile"><div className="tile-num"><Num value={m.shortlisted} /></div><div className="tile-label">Shortlisted</div></div>
        <div className="tile"><div className="tile-num amber"><Num value={m.avg} decimals={1} /></div><div className="tile-label">Avg shortlist score</div></div>
        <div className="tile"><div className="tile-num emerald"><Num value={m.hireRate} decimals={1} />%</div><div className="tile-label">Hire rate</div></div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <label className="switch"><input type="checkbox" checked={table} onChange={(e) => setTable(e.target.checked)} /><span className="track" /><span><Table2 size={13} style={{ verticalAlign: -2 }} /> Show as tables</span></label>
      </div>

      <div className="charts-2">
        <section className="card">
          <h3>Applications screened per week</h3>
          {table ? <DataTable rows={m.weeks} /> : (
            <div className="bars">
              {m.weeks.map((w, i) => (
                <div key={w.label} className={`bar ${w.value === weekMax ? "hi" : ""}`}>
                  <b>{w.value}</b>
                  <span style={{ height: `${Math.max(3, (w.value / weekMax) * 100)}%`, animationDelay: `${i * 0.08}s` }} />
                  {(i === 0 || i === m.weeks.length - 1) && <em>{w.label}</em>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3>Average shortlist score per run</h3>
          {table ? <DataTable rows={m.trend} /> : <TrendLine points={m.trend} />}
        </section>

        <section className="card">
          <h3 className="tight">Hiring funnel</h3>
          <p className="chart-note">Based on statuses you have set across all runs.</p>
          {table ? <DataTable rows={m.funnel} /> : (
            <div className="funnel">
              {m.funnel.map((f) => (
                <div key={f.label} className="funnel-row"><span>{f.label}</span><ProgressBar value={(f.value / funnelMax) * 100} tone={f.tone} height={26} /><b>{f.value}</b></div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="tight">Most-missing requirements</h3>
          <p className="chart-note">Skills applicants most often lack — a sourcing gap, or a nice-to-have in disguise.</p>
          {table ? <DataTable rows={m.topMissing} /> : (
            <div className="hbars">
              {m.topMissing.map((x, i) => (
                <div key={x.label} className="hbar"><span className="lab" title={x.label}>{x.label}</span><span className="track"><span style={{ width: `${(x.value / missMax) * 100}%`, animationDelay: `${i * 0.07}s` }} /></span><span className="v">{x.value}</span></div>
              ))}
              {m.topMissing.length === 0 && <p className="muted small">No gaps recorded yet.</p>}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="tight">Resumes by source</h3>
          <p className="chart-note">Where applications came from.</p>
          {table ? <DataTable rows={m.sources} /> : (
            <div className="hbars">
              {m.sources.map((x, i) => (
                <div key={x.label} className="hbar"><span className="lab">{x.label}</span><span className="track"><span style={{ width: `${(x.value / Math.max(1, ...m.sources.map((s) => s.value))) * 100}%`, animationDelay: `${i * 0.07}s` }} /></span><span className="v">{x.value}</span></div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function TrendLine({ points }: { points: { label: string; short: string; value: number }[] }) {
  const W = 560, H = 170, L = 30, T = 16, B = 152;
  const n = points.length;
  const x = (i: number) => (n <= 1 ? (L + W) / 2 : L + 30 + (i * (W - L - 60)) / (n - 1));
  const y = (v: number) => T + (B - T) * (1 - Math.max(0, Math.min(100, v)) / 100);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line-svg" role="img" aria-label="Average shortlist score per run">
      {[100, 50, 0].map((t) => (
        <g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} className={t === 0 ? "base" : "grid"} /><text x={L - 8} y={y(t) + 4} className="axis" textAnchor="end">{t}</text></g>
      ))}
      {n > 1 && <path d={d} className="path" />}
      {points.map((p, i) => (
        <g key={i}><circle cx={x(i)} cy={y(p.value)} r={5} className="pt"><title>{p.label}: {p.short}</title></circle><text x={x(i)} y={H - 2} className="axis" textAnchor="middle">{p.short}</text></g>
      ))}
    </svg>
  );
}

function DataTable({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <table className="data-tbl">
      <thead><tr><th>Label</th><th style={{ textAlign: "right" }}>Value</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="tabular" style={{ textAlign: "right" }}>{r.value}</td></tr>)}{rows.length === 0 && <tr><td colSpan={2} className="muted">No data</td></tr>}</tbody>
    </table>
  );
}
