import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { Num, Spinner } from "../components/ui";
import { Avatar, initialsOf } from "../components/ds";
import { getProfile, upsertProfile, listRuns } from "../lib/db";

export default function Profile() {
  const { user, configured } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ runs: 0, screened: 0, shortlisted: 0 });
  const [joined, setJoined] = useState("");
  const displayName = fullName || (user?.user_metadata?.full_name as string) || user?.email || "You";

  useEffect(() => {
    if (!configured || !user) return;
    getProfile(user.id).then((p) => { setFullName(p?.full_name ?? (user.user_metadata?.full_name as string) ?? ""); setCompany(p?.company ?? ""); }).catch(() => {});
    setJoined(new Date(user.created_at ?? Date.now()).toLocaleDateString(undefined, { month: "long", year: "numeric" }));
    listRuns().then((rs) => setStats({ runs: rs.length, screened: rs.reduce((s, r) => s + r.total_resumes, 0), shortlisted: rs.reduce((s, r) => s + r.shortlisted, 0) })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, configured]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try { await upsertProfile(user.id, { full_name: fullName, company }); toast.success("Profile saved."); }
    catch (e) { toast.error(`Save failed: ${e instanceof Error ? e.message : ""}`); }
    finally { setSaving(false); }
  }

  return (
    <div className="profile-grid">
      <div className="card profile-hero">
        <Avatar initials={initialsOf(displayName)} tone="emerald" size={84} />
        <h2 title={displayName}>{displayName}</h2>
        <p className="e" title={user?.email}>{user?.email ?? "Local mode — no account"}</p>
        {joined && <p className="j"><Calendar size={12} /> Member since {joined}</p>}
        <div className="profile-stats">
          <span><b><Num value={stats.runs} /></b><small>runs</small></span>
          <span><b><Num value={stats.screened} /></b><small>screened</small></span>
          <span><b className="amber"><Num value={stats.shortlisted} /></b><small>shortlisted</small></span>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Account details</h2></div>
        {!configured && <div className="notice mb"><b>Read-only.</b> Configure Supabase in <code>frontend/.env</code> to edit and persist your profile.</div>}
        <div className="field"><label className="field-label">Full name</label><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!configured} /></div>
        <div className="field"><label className="field-label">Company</label><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ListenFirst" disabled={!configured} /></div>
        <div className="field" style={{ marginBottom: 20 }}><label className="field-label">Email</label><input className="input" value={user?.email ?? ""} disabled /></div>
        <button className="btn btn-primary" onClick={save} disabled={saving || !configured}>{saving ? <Spinner /> : null} {saving ? "Saving…" : "Save changes"}</button>
      </div>
    </div>
  );
}
