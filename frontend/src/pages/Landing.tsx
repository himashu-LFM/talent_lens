import { Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, CheckCircle2, EyeOff, FileSearch, Mail, ShieldCheck, Sparkles, Table2, Zap } from "lucide-react";
import { LogoTile } from "../components/Logo";

const Prism = lazy(() => import("../components/Prism"));

const FEATURES = [
  { icon: BrainCircuit, title: "Hybrid AI scoring, fully offline", body: "On-device semantic matching plus must-have gating and BM25 relevance. No API keys, no data leaving your machine." },
  { icon: Mail, title: "Straight from Gmail", body: "Point it at a label. New applications are fetched, screened and ranked — automatically, on a schedule you set." },
  { icon: Sparkles, title: "Explainable, not a black box", body: "Every score carries evidence snippets, what would raise it, a three-line brief and tailored interview questions." },
  { icon: Table2, title: "A real review workflow", body: "Statuses, notes, bulk actions, side-by-side compare, a requirements heatmap and a drag-and-drop pipeline." },
  { icon: EyeOff, title: "Fairer by design", body: "Anonymized review hides names and contact details. The JD analyzer flags biased wording before you screen." },
  { icon: ShieldCheck, title: "Production-grade", body: "Auth, per-user history, talent pool, analytics, rate limiting, audit-friendly logs and Docker deployment." },
];
const STEPS = [
  { n: "01", title: "Describe the role", body: "Paste the job description. Must-haves, “A or B” alternatives and required years are read automatically, and the JD gets a quality grade before you spend a minute on it." },
  { n: "02", title: "Add resumes", body: "Drop files or connect a Gmail label. Duplicates are collapsed and junk documents — letters, forms, scans — are detected and excluded rather than ranked." },
  { n: "03", title: "Review the shortlist", body: "Ranked candidates with evidence, a coverage heatmap and suggested questions. Shortlist, email, export — all from the keyboard." },
];
const MOCK = [
  { r: 1, n: "Priya Sharma", s: 91, k: "python · pytorch · rag · vector databases" },
  { r: 2, n: "Rupesh Kumar", s: 82, k: "prompt engineering · tensorflow · docker" },
  { r: 3, n: "Daniel Osei", s: 76, k: "pytorch · docker · aws · kubernetes" },
  { r: 4, n: "Mei Lin", s: 63, k: "python · sql · tableau" },
];
const reveal = (d = 0) => ({ initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.7, delay: d, ease: [0.16, 1, 0.3, 1] } });

export default function Landing() {
  return (
    <div className="landing">
      <Suspense fallback={null}><Prism className="prism-canvas" /></Suspense>
      <div className="l-glow" aria-hidden />

      <header className="l-header">
        <div className="l-header-inner">
          <Link to="/" className="l-brand"><LogoTile size={36} radius={12} glyph={22} /><span>TalentLens</span></Link>
          <div className="grow" />
          <a href="#how" className="l-link">How it works</a>
          <a href="#features" className="l-link">Features</a>
          <Link to="/login" className="btn btn-ghost sm" style={{ height: 38, borderRadius: 11 }}>Sign in</Link>
          <Link to="/login?mode=up" className="btn btn-grad sm" style={{ height: 38, borderRadius: 11 }}>Open the app</Link>
        </div>
      </header>

      <section className="l-hero">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="l-eyebrow"><Zap size={13} /> Offline AI screening · no API key</div>
          <h1>Read every resume.<br /><span className="grad-text">Trust the shortlist.</span></h1>
          <p>TalentLens scores every applicant against your job description with explainable hybrid AI, then hands you a ranked shortlist with the evidence behind each number — pulled straight from Gmail if you like.</p>
          <div className="l-cta">
            <Link to="/login?mode=up" className="btn btn-grad">Start screening <ArrowRight size={17} /></Link>
            <a href="#how" className="btn btn-ghost">See how it works</a>
          </div>
          <ul className="l-proof">
            <li><CheckCircle2 size={15} /> Evidence for every score</li>
            <li><CheckCircle2 size={15} /> Gmail auto-screen</li>
            <li><CheckCircle2 size={15} /> Anonymized review</li>
          </ul>
        </motion.div>
      </section>

      <motion.section className="l-mock-wrap" {...reveal()}>
        <div className="l-mock">
          <div className="l-mock-bar"><i /><i /><i /><em>TalentLens — Shortlist · Senior AI Engineer</em></div>
          <div className="l-mock-body">
            <div className="l-mock-stats">
              <div><b>42</b><span>screened</span></div>
              <div><b>10</b><span>shortlisted</span></div>
              <div><b className="amber">71.3</b><span>avg score</span></div>
              <div><b>3</b><span>excluded</span></div>
            </div>
            {MOCK.map((m, i) => {
              const c = m.s >= 80 ? "var(--emerald-400)" : "var(--amber-400)";
              return (
                <div key={m.r} className="l-mock-row">
                  <span className={`rank ${m.r <= 3 ? "r" + m.r : ""}`} style={{ width: 26, height: 26, fontSize: 12 }}>{m.r}</span>
                  <span className="n"><b>{m.n}</b><span>{m.k}</span></span>
                  <span className="track"><span style={{ width: `${m.s}%`, background: c, animationDelay: `${0.2 + i * 0.1}s` }} /></span>
                  <b style={{ color: c }}>{m.s}</b>
                </div>
              );
            })}
          </div>
        </div>
      </motion.section>

      <section id="features" className="l-section">
        <motion.div className="l-head" {...reveal()}>
          <h2>Everything a screening tool should have</h2>
          <p>Built for recruiters who want speed without giving up judgment.</p>
        </motion.div>
        <div className="l-grid-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div key={f.title} className="l-feat" {...reveal(i * 0.05)}>
                <div className="l-feat-ico"><Icon size={21} /></div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section id="how" className="l-section">
        <motion.div className="l-head" {...reveal()}><h2>Three steps from inbox to interview list</h2></motion.div>
        <div className="l-grid-3">
          {STEPS.map((s, i) => (
            <motion.div key={s.n} className="l-step" {...reveal(i * 0.08)}>
              <span className="n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <motion.section className="l-section" {...reveal()}>
        <div className="l-cta-band">
          <FileSearch size={30} />
          <h2>Screen your first batch in under a minute.</h2>
          <p>No credit card, no API key. Your resumes never leave your machine.</p>
          <Link to="/login?mode=up" className="btn btn-grad" style={{ height: 52, padding: "0 26px", fontSize: 15, borderRadius: 14 }}>Create free account <ArrowRight size={17} /></Link>
        </div>
      </motion.section>

      <footer className="l-footer">
        <span className="brand"><LogoTile size={24} radius={8} glyph={15} /><b>TalentLens</b></span>
        <span>© {new Date().getFullYear()} ListenFirst · Scores assist human review, they are not hiring decisions.</span>
      </footer>
    </div>
  );
}
