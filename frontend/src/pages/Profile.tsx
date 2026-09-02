import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Calendar, Mail, Save, UserCircle2 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { Num, Spinner } from "../components/ui";
import { getProfile, upsertProfile, listRuns } from "../lib/db";

function initials(s: string) {
  const parts = s.split("@")[0].split(/[.\s_]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export default function Profile() {
  const { user, configured } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ runs: 0, screened: 0, shortlisted: 0 });
  const [joined, setJoined] = useState("");
  const displayName = fullName || (user?.user_metadata?.full_name as string) || user?.email || "User";

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
    <main className="page">
      <div className="page-head"><h1><UserCircle2 size={26} className="h-ico" /> Profile</h1><p>Your account and screening activity.</p></div>
      <div className="profile-grid">
        <motion.div className="panel profile-hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="profile-avatar">{initials(displayName)}</div>
          <h2 title={displayName}>{displayName}</h2>
          <p className="muted ellipsis" title={user?.email}>{user?.email}</p>
          {joined && <p className="joined"><Calendar size={13} /> Member since {joined}</p>}
          <div className="profile-stats">
            <div><b><Num value={stats.runs} /></b><span>runs</span></div>
            <div><b><Num value={stats.screened} /></b><span>screened</span></div>
            <div><b className="accent"><Num value={stats.shortlisted} /></b><span>shortlisted</span></div>
          </div>
        </motion.div>

        <motion.div className="panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <div className="panel-head"><h2>Account details</h2></div>
          {!configured && <div className="notice mb"><b>Read-only.</b> Configure Supabase in <code>frontend/.env</code> to edit and persist your profile.</div>}
          <div className="field"><label className="field-label">Full name</label><div className="input-ico"><UserCircle2 size={16} /><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!configured} /></div></div>
          <div className="field"><label className="field-label">Company</label><div className="input-ico"><Building2 size={16} /><input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ListenFirst" disabled={!configured} /></div></div>
          <div className="field"><label className="field-label">Email</label><div className="input-ico"><Mail size={16} /><input className="input" value={user?.email ?? ""} disabled /></div></div>
          <button className="btn btn-primary" onClick={save} disabled={saving || !configured}>{saving ? <Spinner /> : <Save size={15} />} {saving ? "Saving…" : "Save changes"}</button>
        </motion.div>
      </div>
    </main>
  );
}
