/* Invite redemption at /join/:token.
   The token is matched against the signed-in user's own email inside the
   database function, so it cannot be used to join an arbitrary team. */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Users } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useWorkspace } from "../context/Workspace";
import { acceptInvite } from "../lib/db";
import { LogoTile } from "../components/Logo";
import { Spinner } from "../components/ui";

export default function Join() {
  const { token = "" } = useParams();
  const { user, loading, configured } = useAuth();
  const { refreshOrgs, switchOrg } = useWorkspace();
  const nav = useNavigate();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!configured) { setState("error"); setMessage("This app isn't connected to a database yet."); return; }
    if (!user) return;                       // the sign-in prompt below handles it
    let live = true;
    acceptInvite(token)
      .then(async (orgId) => {
        if (!live) return;
        await refreshOrgs();
        switchOrg(orgId);
        setState("done");
        setTimeout(() => nav("/"), 1600);
      })
      .catch((e) => {
        if (!live) return;
        setState("error");
        setMessage(e instanceof Error ? e.message : "That invite couldn't be used.");
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, configured, token]);

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="pub-head-in"><LogoTile size={32} radius={10} glyph={20} /><b>TalentLens</b></div>
      </header>
      <div className="pub-wrap pub-done">
        {loading || (user && state === "working") ? (
          <>
            <Spinner size={26} />
            <h1 className="pub-title" style={{ marginTop: 20 }}>Joining the team…</h1>
          </>
        ) : !user ? (
          <>
            <div className="tick" style={{ background: "rgba(245,158,11,.14)", color: "var(--accent-text)" }}>
              <Users size={30} />
            </div>
            <h1 className="pub-title">You've been invited to a team</h1>
            <p className="muted" style={{ maxWidth: 440, margin: "0 auto 24px", lineHeight: 1.7 }}>
              Sign in with the email address the invite was sent to, and you'll join automatically.
            </p>
            <Link className="btn btn-primary" to={`/login?next=/join/${token}`}>Sign in to accept</Link>
            <p className="pub-note" style={{ maxWidth: 440, margin: "20px auto 0" }}>
              No account yet? Create one with that same email — the invite is applied on signup.
            </p>
          </>
        ) : state === "done" ? (
          <>
            <div className="tick"><CheckCircle2 size={30} /></div>
            <h1 className="pub-title">You're in</h1>
            <p className="muted">Taking you to the app…</p>
          </>
        ) : (
          <>
            <div className="tick" style={{ background: "rgba(239,68,68,.14)", color: "var(--danger)" }}>
              <AlertCircle size={30} />
            </div>
            <h1 className="pub-title">That invite didn't work</h1>
            <p className="muted" style={{ maxWidth: 460, margin: "0 auto 24px", lineHeight: 1.7 }}>{message}</p>
            <Link className="btn btn-ghost" to="/">Go to the app</Link>
          </>
        )}
      </div>
    </div>
  );
}
