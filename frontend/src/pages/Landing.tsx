import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, CheckCircle2, EyeOff, FileSearch, Mail, ShieldCheck, Sparkles, Table2, Zap } from "lucide-react";
import Logo, { Wordmark } from "../components/Logo";

const FEATURES = [
  { icon: BrainCircuit, title: "Hybrid AI scoring, fully offline", body: "On-device semantic matching plus must-have gating and BM25 relevance. No API keys, no data leaving your machine." },
  { icon: Mail, title: "Straight from Gmail", body: "Point it at a label. New applications are fetched, screened and ranked — even automatically on a schedule." },
  { icon: Sparkles, title: "Explainable, not a black box", body: "Every score comes with evidence snippets, what would raise it, a 3-line brief and tailored interview questions." },
  { icon: Table2, title: "A real review workflow", body: "Statuses, notes, bulk actions, side-by-side compare, a requirements heatmap and a drag-and-drop pipeline." },
  { icon: EyeOff, title: "Fairer by design", body: "Anonymized review mode hides names and contact details. The JD analyzer flags biased wording before you screen." },
  { icon: ShieldCheck, title: "Production-grade", body: "Auth, per-user history, talent pool, analytics, rate limiting, audit-friendly logs and Docker deployment." },
];

const STEPS = [
  { n: "01", title: "Describe the role", body: "Paste the job description. Must-haves, alternatives (\"A or B\") and years are read automatically — and the JD gets a quality grade." },
  { n: "02", title: "Add resumes", body: "Drop files or connect a Gmail label. Junk documents are detected and excluded." },
  { n: "03", title: "Review the shortlist", body: "Ranked candidates with evidence, heatmap and questions. Shortlist, email, export." },
];

const fade = (d = 0) => ({ initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-60px" }, transition: { duration: 0.5, delay: d, ease: [0.2, 0.8, 0.2, 1] } });

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-nav-inner">
          <Link to="/" className="topbar-brand"><Logo /><Wordmark /></Link>
          <nav className="l-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <Link to="/login" className="btn btn-ghost sm">Sign in</Link>
            <Link to="/login?mode=up" className="btn btn-primary sm">Get started <ArrowRight size={14} /></Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="hero-bg" aria-hidden><span className="blob b1" /><span className="blob b2" /><span className="grid-lines" /></div>
        <motion.div className="hero-inner" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="eyebrow"><Zap size={13} /> Offline AI screening · no API key</div>
          <h1>Find the best candidates<br /><span className="grad">in seconds, not evenings.</span></h1>
          <p>TalentLens reads every resume, scores it against your job description with explainable hybrid AI, and hands you a ranked shortlist with evidence — pulled straight from Gmail if you like.</p>
          <div className="hero-cta">
            <Link to="/login?mode=up" className="btn btn-primary lg">Start screening <ArrowRight size={16} /></Link>
            <a href="#how" className="btn btn-ghost lg">See how it works</a>
          </div>
          <ul className="hero-proof">
            <li><CheckCircle2 size={15} /> Evidence for every score</li>
            <li><CheckCircle2 size={15} /> Gmail auto-screen</li>
            <li><CheckCircle2 size={15} /> Anonymized review</li>
          </ul>
        </motion.div>

        <motion.div className="mock" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}>
          <div className="mock-bar"><span /><span /><span /><em>TalentLens — Shortlist · AI Engineer</em></div>
          <div className="mock-body">
            <div className="mock-stats">
              {[["42", "screened"], ["10", "shortlisted"], ["71.3", "avg score"], ["3", "excluded"]].map(([n, l]) => <div key={l}><b>{n}</b><span>{l}</span></div>)}
            </div>
            {[
              [1, "Priya Sharma", 91, "python · llm · rag · openai"],
              [2, "Rupesh Kumar", 82, "anthropic · prompt engineering · power bi"],
              [3, "Daniel Osei", 76, "pytorch · machine learning · docker"],
              [4, "Mei Lin", 63, "python · sql · tableau"],
            ].map(([r, n, s, k]) => (
              <div key={String(r)} className="mock-row">
                <span className={`rank-badge ${Number(r) <= 3 ? "r" + r : ""}`}>{r}</span>
                <span className="mock-name">{n}<em>{k}</em></span>
                <span className="mock-bar-track"><i style={{ width: `${s}%` }} /></span>
                <b>{s}</b>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <section id="features" className="l-section">
        <motion.div className="l-head" {...fade()}>
          <h2>Everything a screening tool should have</h2>
          <p>Built for recruiters who want speed without losing judgment.</p>
        </motion.div>
        <div className="feat-grid">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.div key={f.title} className="feat" {...fade(i * 0.05)}>
                <div className="feat-ico"><Icon size={20} /></div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section id="how" className="l-section alt">
        <motion.div className="l-head" {...fade()}>
          <h2>How it works</h2>
          <p>Three steps from inbox to interview list.</p>
        </motion.div>
        <div className="steps-grid">
          {STEPS.map((s, i) => (
            <motion.div key={s.n} className="stepcard" {...fade(i * 0.08)}>
              <span className="stepnum">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="l-section cta">
        <motion.div className="cta-card" {...fade()}>
          <FileSearch size={28} />
          <h2>Screen your first batch in under a minute.</h2>
          <p>No credit card, no API key. Your resumes never leave your machine.</p>
          <Link to="/login?mode=up" className="btn btn-primary lg">Create free account <ArrowRight size={16} /></Link>
        </motion.div>
      </section>

      <footer className="l-footer">
        <div className="topbar-brand"><Logo size={22} /><Wordmark compact /></div>
        <span className="muted">© {new Date().getFullYear()} ListenFirst · Scores assist human review, they are not hiring decisions.</span>
      </footer>
    </div>
  );
}
