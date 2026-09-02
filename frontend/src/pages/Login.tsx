import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import Logo from "../components/Logo";
import { Spinner } from "../components/ui";

export default function Login() {
  const { signIn, signUp, configured } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const [mode, setMode] = useState<"in" | "up">(params.get("mode") === "up" ? "up" : "in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!configured) return toast.error("Supabase isn't configured yet. Add keys to frontend/.env.", 7000);
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
        nav("/");
      } else {
        const { needsConfirm } = await signUp(email, password, fullName);
        if (needsConfirm) { toast.success("Account created — check your email to confirm, then sign in.", 8000); setMode("in"); }
        else nav("/");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed.", 7000);
    } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <div className="hero-bg" aria-hidden><span className="blob b1" /><span className="blob b2" /></div>
        <Link to="/" className="auth-back"><ArrowLeft size={15} /> Back to site</Link>
        <motion.div className="auth-brand-inner" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="auth-logo"><Logo size={76} spin /></div>
          <h1>TalentLens</h1>
          <p className="auth-tag">by ListenFirst</p>
          <ul className="auth-points">
            <li><CheckCircle2 size={16} /> Screen &amp; rank resumes in seconds</li>
            <li><CheckCircle2 size={16} /> Pull applications straight from Gmail</li>
            <li><CheckCircle2 size={16} /> Transparent, explainable scoring</li>
          </ul>
        </motion.div>
      </div>

      <div className="auth-form-wrap">
        <motion.div className="auth-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-selected={mode === "in"} className={mode === "in" ? "on" : ""} onClick={() => setMode("in")}>Sign in</button>
            <button role="tab" aria-selected={mode === "up"} className={mode === "up" ? "on" : ""} onClick={() => setMode("up")}>Create account</button>
            <motion.span className="auth-ind" animate={{ x: mode === "in" ? 0 : "100%" }} transition={{ type: "spring", stiffness: 420, damping: 36 }} />
          </div>

          {!configured && (
            <div className="notice mb"><b>Supabase not configured.</b> Paste your project URL &amp; anon key into <code>frontend/.env</code>, then reload.</div>
          )}

          <form onSubmit={submit} className="auth-form">
            <AnimatePresence initial={false}>
              {mode === "up" && (
                <motion.div key="name" className="field" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                  <label className="field-label">Full name</label>
                  <div className="input-ico"><User size={16} /><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" required autoComplete="name" /></div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="field">
              <label className="field-label">Work email</label>
              <div className="input-ico"><Mail size={16} /><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" /></div>
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <div className="input-ico">
                <Lock size={16} />
                <input className="input" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required autoComplete={mode === "in" ? "current-password" : "new-password"} />
                <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            <button className="btn btn-primary full lg" disabled={busy}>
              {busy ? <Spinner /> : mode === "in" ? <>Sign in <ArrowRight size={16} /></> : <>Create account <ArrowRight size={16} /></>}
            </button>
          </form>

          <p className="auth-switch">
            {mode === "in" ? "New here? " : "Already have an account? "}
            <button onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Create an account" : "Sign in"}</button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
