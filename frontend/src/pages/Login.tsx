import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import Logo from "../components/Logo";

export default function Login() {
  const { signIn, signUp, configured } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!configured) {
      toast.error("Supabase isn't configured yet. Add keys to frontend/.env.", 7000);
      return;
    }
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
        nav("/");
      } else {
        const { needsConfirm } = await signUp(email, password, fullName);
        if (needsConfirm) {
          toast.success("Account created — check your email to confirm, then sign in.", 8000);
          setMode("in");
        } else {
          nav("/");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed.", 7000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      {/* Left brand panel */}
      <div className="auth-brand">
        <div className="auth-orbits">
          <span className="orbit o1" />
          <span className="orbit o2" />
          <span className="orbit o3" />
          <div className="auth-logo"><Logo size={72} /></div>
        </div>
        <h1>TalentLens</h1>
        <p className="auth-tag">by ListenFirst</p>
        <ul className="auth-points">
          <li>Screen &amp; rank resumes in seconds</li>
          <li>Pull applications straight from Gmail</li>
          <li>Transparent, explainable scoring</li>
        </ul>
      </div>

      {/* Right form panel */}
      <div className="auth-form-wrap">
        <motion.div
          className="auth-card"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="auth-tabs">
            <button className={mode === "in" ? "on" : ""} onClick={() => setMode("in")}>
              Sign in
            </button>
            <button className={mode === "up" ? "on" : ""} onClick={() => setMode("up")}>
              Create account
            </button>
            <span className={`auth-ind ${mode}`} />
          </div>

          {!configured && (
            <div className="notice mb">
              <b>Supabase not configured.</b> Paste your project URL &amp; anon key into{" "}
              <code>frontend/.env</code>, then reload.
            </div>
          )}

          <form onSubmit={submit}>
            <AnimatePresence mode="popLayout">
              {mode === "up" && (
                <motion.div
                  key="name"
                  className="field"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="field-label">Full name</label>
                  <input
                    className="input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Chhavi Gupta"
                    required
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="field">
              <label className="field-label">Work email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@listenfirstmedia.com"
                required
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                required
              />
            </div>

            <button className="btn btn-primary full auth-submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="auth-switch">
            {mode === "in" ? "New here? " : "Already have an account? "}
            <button onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
