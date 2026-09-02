import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Briefcase, Database, Mail, Phone, Search, Users } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { EmptyState, Skeleton } from "../components/ui";
import { candidateKey, listAllReviews, listRuns, type Review, type RunRow } from "../lib/db";
import type { Candidate } from "../api";

interface PoolEntry {
  key: string; name: string; email: string; phone: string; experience: number;
  skills: Set<string>; bestScore: number; bestRole: string;
  runs: { id: string; title: string; score: number; date: string }[]; statuses: string[];
}

export default function TalentPool() {
  const { configured } = useAuth();
  const toast = useToast();
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

  const allSkills = useMemo(() => {
    const cnt = new Map<string, number>();
    pool.forEach((p) => p.skills.forEach((s) => cnt.set(s, (cnt.get(s) ?? 0) + 1)));
    return Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [pool]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    return pool
      .filter((p) => p.experience >= minExp && p.bestScore >= minScore && (!skill || p.skills.has(skill)))
      .filter((p) => !t || `${p.name} ${p.email} ${Array.from(p.skills).join(" ")} ${p.runs.map((r) => r.title).join(" ")}`.toLowerCase().includes(t))
      .sort((a, b) => b.bestScore - a.bestScore);
  }, [pool, q, skill, minExp, minScore]);

  return (
    <main className="page">
      <div className="page-head">
        <h1><Users size={26} className="h-ico" /> Talent pool</h1>
        <p>Every candidate you've ever screened, searchable. {pool.length} {pool.length === 1 ? "person" : "people"} across {runs.length} run{runs.length === 1 ? "" : "s"}.</p>
      </div>

      {!configured ? (
        <EmptyState icon={<Database size={30} />} title="Talent pool needs history" body={<>Add Supabase keys to <code>frontend/.env</code> to start building your candidate database.</>} />
      ) : loading ? (
        <>
          <div className="panel"><div className="toolbar pool-toolbar"><Skeleton h={42} r={10} /><Skeleton h={42} r={10} /><Skeleton h={42} r={10} /><Skeleton h={42} r={10} /></div></div>
          <div className="pool-grid">{[0, 1, 2].map((i) => <div key={i} className="pool-card"><Skeleton w="55%" h={18} /><Skeleton w="80%" /><Skeleton w="40%" /><div className="tags sm"><Skeleton w={60} h={22} r={6} /><Skeleton w={70} h={22} r={6} /><Skeleton w={50} h={22} r={6} /></div></div>)}</div>
        </>
      ) : (
        <>
          <div className="panel">
            <div className="toolbar pool-toolbar">
              <div className="input-ico"><Search size={16} /><input className="input" placeholder="Search name, email, skill, role…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <select className="input tb-select" value={skill} onChange={(e) => setSkill(e.target.value)}>
                <option value="">Any skill</option>
                {allSkills.map(([s, n]) => <option key={s} value={s}>{s} ({n})</option>)}
              </select>
              <label className="tb-range"><span>Min experience <b>{minExp}y</b></span><input type="range" min={0} max={15} value={minExp} onChange={(e) => setMinExp(Number(e.target.value))} className="slider" /></label>
              <label className="tb-range"><span>Min best score <b>{minScore}</b></span><input type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="slider" /></label>
            </div>
          </div>

          {results.length === 0 ? (
            <EmptyState icon={<Search size={28} />} title={pool.length ? "No candidates match" : "No candidates yet"} body={pool.length ? "Try loosening the filters." : "Screen some resumes on the dashboard and they'll appear here."} />
          ) : (
            <div className="pool-grid">
              {results.map((p, i) => (
                <motion.article key={p.key} className="pool-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }}>
                  <div className="pool-top">
                    <div className="pool-id">
                      <div className="c-name" title={p.name}>{p.name}</div>
                      <div className="c-sub" title={p.email}><Mail size={12} /> {p.email || p.key}</div>
                      {p.phone && <div className="c-sub"><Phone size={12} /> {p.phone}</div>}
                    </div>
                    <div className="pool-score" title={`Best score · ${p.bestRole}`}>
                      <b className="accent">{p.bestScore}</b>
                      <span>best</span>
                    </div>
                  </div>
                  <div className="pool-meta">
                    <span><Briefcase size={12} /> {p.experience}y exp</span>
                    <span>· seen in {p.runs.length} run{p.runs.length === 1 ? "" : "s"}</span>
                    {p.statuses.length > 0 && <span className="pool-status">· {Array.from(new Set(p.statuses)).join(", ")}</span>}
                  </div>
                  <div className="tags sm">{Array.from(p.skills).slice(0, 8).map((s) => <span key={s} className="tag neutral">{s}</span>)}{p.skills.size > 8 && <span className="tag neutral">+{p.skills.size - 8}</span>}</div>
                  <div className="pool-runs">
                    {p.runs.slice(0, 3).map((r) => <Link key={r.id + r.date} to={`/history?run=${r.id}`} className="pool-run" title={r.title}><span>{r.title}</span><b>{r.score}</b></Link>)}
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
