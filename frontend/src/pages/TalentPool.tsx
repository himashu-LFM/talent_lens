import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Search } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { EmptyState, Skeleton } from "../components/ui";
import { Avatar, Eyebrow, initialsOf, scoreClass, type AvatarTone } from "../components/ds";
import { Sidebar, useWorkspace } from "../context/Workspace";
import { candidateKey, listAllReviews, listRuns, type Review, type RunRow } from "../lib/db";
import type { Candidate } from "../api";

interface PoolEntry {
  key: string; name: string; email: string; phone: string; experience: number;
  skills: Set<string>; bestScore: number; bestRole: string;
  runs: { id: string; title: string; score: number; date: string }[]; statuses: string[];
}
const STATUS_COLOR: Record<string, string> = { shortlisted: "var(--accent-text)", interview: "var(--info)", rejected: "var(--danger)", hired: "var(--success)" };
const toneFor = (s: number): AvatarTone => (s >= 80 ? "emerald" : s >= 60 ? "amber" : "slate");

export default function TalentPool() {
  const { configured } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { setRun, resetFilters } = useWorkspace();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [skill, setSkill] = useState("");
  const [minExp, setMinExp] = useState(0);
  const [minScore, setMinScore] = useState(0);

  useEffect(() => {
    if (!configured) { setLoading(false); return; }
    Promise.all([listRuns(), listAllReviews()])
      .then(([r, rv]) => { setRuns(r); setReviews(rv); })
      .catch((e) => toast.error(`Couldn't load talent pool: ${e.message}`))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  const pool = useMemo(() => {
    const map = new Map<string, PoolEntry>();
    const st = new Map(reviews.map((r) => [`${r.run_id}|${r.candidate_key}`, r.status]));
    for (const run of runs) {
      for (const c of (run.results?.ranked ?? []) as Candidate[]) {
        const key = candidateKey(c);
        if (!key) continue;
        const e = map.get(key) ?? { key, name: c.name, email: c.email, phone: c.phone, experience: c.experience_years, skills: new Set<string>(), bestScore: 0, bestRole: "", runs: [], statuses: [] };
        c.skills.forEach((s) => e.skills.add(s));
        c.matched_skills.forEach((s) => e.skills.add(s));
        e.experience = Math.max(e.experience, c.experience_years);
        if (c.score > e.bestScore) { e.bestScore = c.score; e.bestRole = run.title; }
        e.runs.push({ id: run.id, title: run.title, score: c.score, date: run.created_at });
        const s = st.get(`${run.id}|${key}`);
        if (s && s !== "new") e.statuses.push(s);
        map.set(key, e);
      }
    }
    return Array.from(map.values());
  }, [runs, reviews]);

  const topSkills = useMemo(() => {
    const cnt = new Map<string, number>();
    pool.forEach((p) => p.skills.forEach((s) => cnt.set(s, (cnt.get(s) ?? 0) + 1)));
    return Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [pool]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    return pool
      .filter((p) => p.experience >= minExp && p.bestScore >= minScore && (!skill || p.skills.has(skill)))
      .filter((p) => !t || `${p.name} ${p.email} ${Array.from(p.skills).join(" ")} ${p.runs.map((r) => r.title).join(" ")}`.toLowerCase().includes(t))
      .sort((a, b) => b.bestScore - a.bestScore);
  }, [pool, q, skill, minExp, minScore]);

  function openRun(id: string) {
    const r = runs.find((x) => x.id === id);
    if (!r) return;
    resetFilters();
    setRun({ data: r.results, runId: r.id, files: [], title: r.title, source: "history", at: r.created_at });
    nav("/shortlist");
  }

  const sidebar = (
    <Sidebar>
      <div>
        <Eyebrow>Search the pool</Eyebrow>
        <div className="input-ico"><Search size={15} /><input className="input" placeholder="Name, skill, past role…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the pool" /></div>
      </div>
      <div className="ctx-range">
        <div className="l"><span>Minimum experience</span><b>{minExp}y</b></div>
        <input type="range" className="range" min={0} max={15} value={minExp} onChange={(e) => setMinExp(Number(e.target.value))} aria-label="Minimum experience" />
      </div>
      <div className="ctx-range">
        <div className="l"><span>Minimum best score</span><b>{minScore}</b></div>
        <input type="range" className="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Minimum best score" />
      </div>
      {topSkills.length > 0 && (
        <div>
          <Eyebrow>Top skills</Eyebrow>
          <div className="chips">
            {topSkills.map(([s, n]) => (
              <button key={s} className={`chip click ${skill === s ? "amber" : ""}`} onClick={() => setSkill(skill === s ? "" : s)} aria-pressed={skill === s}>{s} <b className="tabular">{n}</b></button>
            ))}
          </div>
        </div>
      )}
      <div className="muted small">{pool.length} {pool.length === 1 ? "person" : "people"} across {runs.length} run{runs.length === 1 ? "" : "s"}</div>
    </Sidebar>
  );

  if (!configured) return <div className="page"><EmptyState icon={<Database size={26} />} title="Talent pool needs history" body={<>Add Supabase keys to <code>frontend/.env</code> to start building your candidate database.</>} /></div>;
  if (loading) return <div className="page pool-grid">{[0, 1, 2].map((i) => <div key={i} className="pool-card"><Skeleton w="55%" h={18} /><Skeleton w="80%" /><Skeleton w="40%" /><div className="chips"><Skeleton w={60} h={22} r={6} /><Skeleton w={70} h={22} r={6} /><Skeleton w={50} h={22} r={6} /></div></div>)}</div>;

  return (
    <div className="page">
      {sidebar}
      {results.length === 0 ? (
        <EmptyState icon={<Search size={26} />} title={pool.length ? "No candidates match" : "No candidates yet"} body={pool.length ? "Try loosening the filters in the sidebar." : "Screen some resumes and they'll appear here."} />
      ) : (
        <div className="pool-grid">
          {results.map((p) => {
            const skills = Array.from(p.skills);
            const uniq = Array.from(new Set(p.statuses));
            return (
              <article key={p.key} className="pool-card card-hover">
                <div className="pool-top">
                  <Avatar initials={initialsOf(p.name || p.email)} tone={toneFor(p.bestScore)} size={42} />
                  <div className="pool-id">
                    <div className="n" title={p.name}>{p.name}</div>
                    <div className="e" title={p.email}>{p.email || p.key}</div>
                  </div>
                  <div className="pool-best" title={`Best score · ${p.bestRole}`}><b className={`sc-${scoreClass(p.bestScore)}`}>{p.bestScore}</b><div>best</div></div>
                </div>
                <div className="pool-meta">
                  {p.experience}y experience · seen in {p.runs.length} run{p.runs.length === 1 ? "" : "s"}
                  {uniq.length > 0 && <> · {uniq.map((s, i) => <span key={s} style={{ color: STATUS_COLOR[s] }}>{i ? ", " : ""}{s}</span>)}</>}
                </div>
                <div className="chips">{skills.slice(0, 6).map((s) => <span key={s} className="chip">{s}</span>)}{skills.length > 6 && <span className="chip">+{skills.length - 6}</span>}</div>
                <div className="pool-runs">
                  {p.runs.slice(0, 3).map((r) => <button key={r.id + r.date} className="pool-run" onClick={() => openRun(r.id)} title={r.title}><span>{r.title}</span><b>{r.score}</b></button>)}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
