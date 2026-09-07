import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { LogoTile } from "../components/Logo";
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
      if (mode === "in") { await signIn(email, password); nav("/"); }
      else {
        const { needsConfirm } = await signUp(email, password, fullName);
        if (needsConfirm) { toast.success("Account created — check your email to confirm, then sign in.", 8000); setMode("in"); }
        else nav("/");
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : "Authentication failed.", 7000); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-left">
        <div className="auth-blob a" aria-hidden /><div className="auth-blob b" aria-hidden />
        <Link to="/" className="auth-back"><ArrowLeft size={15} /> Back to site</Link>
        <div className="auth-brand fade-in">
          <div className="auth-tile"><LogoTile size={84} radius={26} glyph={50} /></div>
          <h1>TalentLens</h1>
          <p className="auth-tag">Resume screening, explained</p>
          <ul className="auth-points">
            <li><CheckCircle2 size={17} /> Screen and rank resumes in seconds</li>
            <li><CheckCircle2 size={17} /> Pull applications straight from Gmail</li>
            <li><CheckCircle2 size={17} /> Transparent, evidence-backed scoring</li>
          </ul>
        </div>
      </div>

      <div className="auth-right">
        <div className="auth-card fade-in" style={{ animationDelay: ".08s" }}>
          <div className="auth-tabs" role="tablist">
            <span className="auth-ind" style={{ transform: mode === "in" ? "translateX(0)" : "translateX(100%)" }} aria-hidden />
            <button type="button" role="tab" aria-selected={mode === "in"} className={mode === "in" ? "on" : ""} onClick={() => setMode("in")}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "up"} className={mode === "up" ? "on" : ""} onClick={() => setMode("up")}>Create account</button>
          </div>

          {!configured && <div className="notice warn mb"><b>Supabase not configured.</b> Paste your project URL &amp; anon key into <code>frontend/.env</code>, then reload.</div>}

          <form onSubmit={submit}>
            {mode === "up" && (
              <div className="field fade-in">
                <label className="field-label">Full name</label>
                <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" required autoComplete="name" />
              </div>
            )}
            <div className="field">
              <label className="field-label">Work email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
            </div>
            <div className="field" style={{ marginBottom: 22 }}>
              <label className="field-label">Password</label>
              <div className="input-ico" style={{ display: "flex" }}>
                <input className="input" style={{ paddingLeft: 13 }} type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required autoComplete={mode === "in" ? "current-password" : "new-password"} />
                <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </div>
            <button className="btn btn-primary full" disabled={busy}>{busy ? <Spinner /> : mode === "in" ? "Sign in" : "Create account"}</button>
          </form>

          <p className="auth-switch">
            {mode === "in" ? "New here? " : "Already have an account? "}
            <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "Create an account" : "Sign in"}</button>
          </p>
        </div>
      </div>
    </div>
  );
}
