/* Settings — team roster, connections, email templates, automation, taxonomy,
   compliance (retention, erasure requests, audit trail) and appearance. */
import { useCallback, useEffect, useState } from "react";
import {
  Check, Copy, FileClock, Link2, Mail, Moon, Palette, Play, Plus, Radar, ShieldCheck,
  Sun, Tags, Trash2, Users,
} from "lucide-react";
import { useToast } from "../components/Toast";
import { Avatar, Badge, SegTabs, initialsOf } from "../components/ds";
import { EmptyState, Spinner } from "../components/ui";
import { useWorkspace, useMemberName } from "../context/Workspace";
import { useAuth } from "../auth/AuthProvider";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import { MERGE_FIELDS } from "../lib/merge";
import {
  ROLES, ROLE_BLURB, ROLE_LABEL, createDeletionRequest, deleteTemplate, inviteLink,
  inviteMember, isAdmin, listAudit, listDeletionRequests, listInvites, listMembers,
  listQueue, listTemplates, removeMember, revokeInvite, saveTemplate, updateMemberRole,
  updateOrg, canWrite,
  type AuditEntry, type DeletionRequest, type EmailTemplate, type Invite, type Member,
  type QueuedEmail, type Role, type TemplateStage,
} from "../lib/db";
import {
  addCustomSkill, deleteWatch, gmailConnect, gmailDisconnect, gmailStatus, listSkills,
  listWatches, removeCustomSkill, runWatch, updateWatch, type GmailStatus, type Watch,
} from "../api";

type Tab = "team" | "connections" | "templates" | "automation" | "taxonomy" | "compliance" | "appearance";

const TABS: [Tab, string][] = [
  ["team", "Team"], ["connections", "Connections"], ["templates", "Email templates"],
  ["automation", "Automation"], ["taxonomy", "Taxonomy"], ["compliance", "Compliance"],
  ["appearance", "Appearance"],
];

const STAGES: TemplateStage[] = ["ack", "shortlisted", "interview", "rejected", "hired", "custom"];
const STAGE_LABEL: Record<TemplateStage, string> = {
  ack: "Application received", shortlisted: "Shortlisted", interview: "Interview confirmed",
  rejected: "Not moving forward", hired: "Offer", custom: "Custom",
};

const RETENTION_OPTIONS = [
  { days: 0, label: "Keep indefinitely" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
];

function msg(e: unknown) { return e instanceof Error ? e.message : "unknown error"; }
function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Settings() {
  const toast = useToast();
  const { user, configured } = useAuth();
  const { orgId, org, role, refreshOrgs, refreshReady, ready } = useWorkspace();
  const nameOf = useMemberName();
  const admin = isAdmin(role);
  const mayWrite = canWrite(role);
  const [tab, setTab] = useState<Tab>("team");
  const [theme, setTheme] = useState<Theme>(getTheme());

  /* ---- team ---- */
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("recruiter");
  const [orgName, setOrgName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [copied, setCopied] = useState("");

  /* ---- gmail / watches / skills ---- */
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [custom, setCustom] = useState<Record<string, string[]>>({});
  const [builtinCount, setBuiltinCount] = useState(0);
  const [skillName, setSkillName] = useState("");
  const [aliases, setAliases] = useState("");

  /* ---- templates & queue ---- */
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [editing, setEditing] = useState<Partial<EmailTemplate> | null>(null);
  const [queue, setQueue] = useState<QueuedEmail[]>([]);

  /* ---- compliance ---- */
  const [retention, setRetention] = useState(0);
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [eraseEmail, setEraseEmail] = useState("");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    gmailStatus().then(setGmail).catch(() => {});
    listSkills().then((s) => { setCustom(s.custom); setBuiltinCount(Object.keys(s.builtin).length); }).catch(() => {});
    listWatches().then(setWatches).catch(() => {});
  }, []);

  useEffect(() => {
    if (org) { setOrgName(org.name); setContactEmail(org.contact_email ?? ""); setRetention(org.retention_days); }
  }, [org]);

  const loadOrgData = useCallback(async () => {
    if (!orgId || !configured) return;
    try {
      const [m, i] = await Promise.all([listMembers(orgId), admin ? listInvites(orgId) : Promise.resolve([])]);
      setMembers(m); setInvites(i);
    } catch { /* RLS may block invites for non-admins */ }
  }, [orgId, configured, admin]);

  useEffect(() => { loadOrgData(); }, [loadOrgData]);

  useEffect(() => {
    if (!orgId || !configured) return;
    if (tab === "templates") {
      listTemplates(orgId).then(setTemplates).catch(() => {});
      listQueue(orgId, 40).then(setQueue).catch(() => {});
    }
    if (tab === "compliance") {
      listDeletionRequests(orgId).then(setRequests).catch(() => {});
      listAudit(orgId, 150).then(setAudit).catch(() => setAudit([]));
    }
  }, [tab, orgId, configured]);

  /* ---- actions ---- */
  async function saveOrg() {
    if (!orgId) return;
    try {
      await updateOrg(orgId, { name: orgName.trim() || "My team", contact_email: contactEmail.trim() || null });
      await refreshOrgs();
      toast.success("Team saved.");
    } catch (e) { toast.error(`Couldn't save: ${msg(e)}`); }
  }

  async function invite() {
    if (!orgId || !user) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email.includes("@")) return toast.error("Enter a valid email address.");
    try {
      const row = await inviteMember(orgId, user.id, email, inviteRole);
      setInvites((cur) => [row, ...cur.filter((i) => i.email !== row.email)]);
      setInviteEmail("");
      await navigator.clipboard?.writeText(inviteLink(row.token)).catch(() => {});
      toast.success(`Invite ready for ${email} — link copied. Send it to them.`, 7000);
    } catch (e) { toast.error(`Couldn't invite: ${msg(e)}`); }
  }

  async function changeRole(m: Member, next: Role) {
    if (!orgId) return;
    if (m.user_id === user?.id && next !== "admin") {
      const others = members.filter((x) => x.role === "admin" && x.user_id !== m.user_id);
      if (!others.length) return toast.error("You're the only admin. Promote someone else first.");
    }
    try {
      await updateMemberRole(orgId, m.user_id, next);
      setMembers((cur) => cur.map((x) => (x.user_id === m.user_id ? { ...x, role: next } : x)));
      if (m.user_id === user?.id) await refreshOrgs();
      toast.success(`${m.full_name || m.email} is now a ${ROLE_LABEL[next].toLowerCase()}.`);
    } catch (e) { toast.error(`Couldn't change role: ${msg(e)}`); }
  }

  async function kick(m: Member) {
    if (!orgId) return;
    if (!window.confirm(`Remove ${m.full_name || m.email} from this team?`)) return;
    try {
      await removeMember(orgId, m.user_id);
      setMembers((cur) => cur.filter((x) => x.user_id !== m.user_id));
      toast.success("Removed from the team.");
    } catch (e) { toast.error(`Couldn't remove: ${msg(e)}`); }
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(token);
      setTimeout(() => setCopied(""), 1800);
    } catch { toast.info(inviteLink(token), 9000); }
  }

  async function connect() {
    setBusy(true);
    const id = toast.loading("Opening Google sign-in…");
    try {
      const r = await gmailConnect();
      setGmail({ configured: true, connected: true, can_send: r.can_send });
      toast.update(id, "success", `Connected: ${r.email}`);
      refreshReady();
    } catch (e) { toast.update(id, "error", `Connect failed: ${msg(e)}`, 7000); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    try {
      await gmailDisconnect();
      setGmail((g) => (g ? { ...g, connected: false, can_send: false } : g));
      refreshReady();
      toast.info("Gmail disconnected. Connect again to grant permissions (including sending).");
    } catch (e) { toast.error(msg(e)); }
  }

  async function addSkill() {
    if (!skillName.trim()) return;
    try {
      setCustom(await addCustomSkill(skillName, aliases.split(",").map((a) => a.trim()).filter(Boolean)));
      toast.success(`Skill “${skillName.trim()}” added to the taxonomy.`);
      setSkillName(""); setAliases("");
    } catch (e) { toast.error(`Couldn't add: ${msg(e)}`); }
  }

  async function persistTemplate() {
    if (!orgId || !user || !editing) return;
    if (!editing.name?.trim() || !editing.subject?.trim() || !editing.body?.trim()) {
      return toast.error("Name, subject and body are all required.");
    }
    try {
      const row = await saveTemplate(orgId, user.id, {
        id: editing.id, name: editing.name.trim(), stage: (editing.stage ?? "custom") as TemplateStage,
        subject: editing.subject, body: editing.body, is_default: true,
      });
      setTemplates((cur) => [row, ...cur.filter((t) => t.id !== row.id)]);
      setEditing(null);
      toast.success("Template saved. It's used automatically for that stage.");
    } catch (e) { toast.error(`Couldn't save: ${msg(e)}`); }
  }

  async function saveRetention(days: number) {
    if (!orgId) return;
    try {
      await updateOrg(orgId, { retention_days: days });
      setRetention(days);
      await refreshOrgs();
      toast.success(days === 0
        ? "Retention off — candidate data is kept until you delete it."
        : `Candidate data will be erased ${days} days after it arrives.`, 6000);
    } catch (e) { toast.error(`Couldn't save: ${msg(e)}`); }
  }

  async function requestErase() {
    if (!orgId) return;
    const email = eraseEmail.trim().toLowerCase();
    if (!email.includes("@")) return toast.error("Enter the candidate's email address.");
    if (!window.confirm(`Erase all personal data for ${email}? This cannot be undone.`)) return;
    try {
      await createDeletionRequest(orgId, email, "requested by recruiter");
      setRequests(await listDeletionRequests(orgId));
      setEraseEmail("");
      toast.success("Queued. The server erases it on the next sweep.", 6000);
    } catch (e) { toast.error(`Couldn't queue: ${msg(e)}`); }
  }

  if (!configured) {
    return <EmptyState icon={<Users size={26} />} title="Settings need a database"
      body={<>Add Supabase keys to <code>frontend/.env</code> to manage your team and compliance settings.</>} />;
  }

  return (
    <div className="page">
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k}
            className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {/* ============================================ TEAM */}
      {tab === "team" && (
        <div className="settings-grid">
          <section className="card">
            <div className="card-head"><h2><Users size={17} /> Members</h2>
              <span className="count-pill">{members.length}</span></div>
            {members.map((m) => (
              <div className="job-row" key={m.user_id}>
                <div className="job-main" style={{ display: "flex", gap: 11, alignItems: "center" }}>
                  <Avatar initials={initialsOf(m.full_name || m.email || "?")} tone="slate" size={34} />
                  <div style={{ minWidth: 0 }}>
                    <b className="ellipsis">{m.full_name || m.email || "Teammate"}</b>
                    <div className="job-meta">
                      <span className="ellipsis">{m.email}</span>
                      {m.user_id === user?.id && <span>you</span>}
                    </div>
                  </div>
                </div>
                <div className="job-actions">
                  {admin ? (
                    <select className="input" style={{ width: 132, height: 34, fontSize: 12.5 }}
                      value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}
                      aria-label={`Role for ${m.full_name || m.email}`}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <Badge variant={m.role === "admin" ? "warning" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>}
                  {admin && m.user_id !== user?.id && (
                    <button className="btn btn-ghost sm icon-only danger" onClick={() => kick(m)}
                      title="Remove from team" aria-label="Remove from team"><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            ))}
            <div style={{ marginTop: 14 }}>
              {ROLES.map((r) => (
                <p className="hint" key={r} style={{ marginTop: 4 }}>
                  <b style={{ color: "var(--text-2)" }}>{ROLE_LABEL[r]}</b> — {ROLE_BLURB[r]}
                </p>
              ))}
            </div>
          </section>

          {admin && (
            <>
              <section className="card">
                <div className="card-head"><h2><Plus size={17} /> Invite someone</h2></div>
                <div className="create-row" style={{ marginBottom: 12 }}>
                  <input className="input" placeholder="name@company.com" value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && invite()} />
                  <select className="input" style={{ width: 140 }} value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)} aria-label="Invite role">
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button className="btn btn-primary" onClick={invite}>Invite</button>
                </div>
                <p className="hint" style={{ marginTop: 0 }}>
                  We don't send the email — copy the link and send it however you like. It only works
                  for the address you typed.
                </p>
                {invites.filter((i) => !i.accepted_at).length > 0 && (
                  <>
                    <span className="sub-h" style={{ marginTop: 16 }}>Pending</span>
                    {invites.filter((i) => !i.accepted_at).map((i) => (
                      <div className="skill-row" key={i.id}>
                        <b className="ellipsis">{i.email}</b>
                        <span>{ROLE_LABEL[i.role]}</span>
                        <button className="link-btn" onClick={() => copyLink(i.token)}>
                          {copied === i.token ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Link</>}
                        </button>
                        <button className="link-btn danger" onClick={async () => {
                          await revokeInvite(i.id);
                          setInvites((cur) => cur.filter((x) => x.id !== i.id));
                        }}>revoke</button>
                      </div>
                    ))}
                  </>
                )}
              </section>

              <section className="card">
                <div className="card-head"><h2>Team details</h2></div>
                <div className="field">
                  <label className="field-label">Team name</label>
                  <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Reply-to address shown to candidates</label>
                  <input className="input" type="email" value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)} placeholder="careers@company.com" />
                </div>
                <button className="btn btn-primary" onClick={saveOrg}>Save</button>
              </section>
            </>
          )}
        </div>
      )}

      {/* ============================================ CONNECTIONS */}
      {tab === "connections" && (
        <div className="settings-grid">
          <section className="card">
            <div className="card-head">
              <h2><Mail size={17} /> Gmail</h2>
              <span className={`pill-status ${gmail?.connected ? "on" : ""}`}><i />
                {gmail?.connected ? "Connected" : "Not connected"}</span>
            </div>
            {gmail && !gmail.configured && (
              <div className="notice warn mb"><b>Not configured.</b> Add{" "}
                <code>credentials.json</code> to the backend folder (see README).</div>
            )}
            <ul className="perm-list">
              <li><i className={gmail?.connected ? "ok" : ""} />Read resume attachments and mark as read</li>
              <li><i className={gmail?.can_send ? "ok" : ""} />Send emails to candidates{" "}
                {gmail?.connected && !gmail?.can_send && <em>— reconnect to grant</em>}</li>
            </ul>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {gmail?.connected ? (
                <>
                  <button className="btn btn-secondary" onClick={disconnect}>Disconnect</button>
                  {!gmail.can_send && (
                    <button className="btn btn-primary" disabled={busy}
                      onClick={async () => { await disconnect(); await connect(); }}>
                      Reconnect to enable sending
                    </button>
                  )}
                </>
              ) : (
                <button className="btn btn-primary" onClick={connect} disabled={busy || !gmail?.configured}>
                  <Mail size={15} /> {busy ? "Waiting for Google…" : "Connect Gmail"}
                </button>
              )}
            </div>
            <p className="hint">
              Sending is what delivers queued candidate emails and interview invites. Without it,
              messages stay queued.
            </p>
          </section>

          <section className="card">
            <div className="card-head"><h2><ShieldCheck size={17} /> Server capabilities</h2></div>
            <ul className="perm-list">
              <li><i className={ready?.semantic_model === "ready" ? "ok" : ""} />
                Semantic matching {ready?.semantic_model === "ready" ? "ready" : "unavailable (lexical mode)"}</li>
              <li><i className={ready?.ocr === "ready" ? "ok" : ""} />
                OCR for scanned resumes {ready?.ocr === "ready" ? "ready" : `— ${ready?.ocr ?? "unknown"}`}</li>
              <li><i className={ready?.llm?.available ? "ok" : ""} />
                AI second opinion {ready?.llm?.available ? `ready (${ready.llm.model})` : `— ${ready?.llm?.status ?? "not configured"}`}</li>
              <li><i className={ready?.supabase ? "ok" : ""} />
                Public apply links {ready?.supabase ? "ready" : "— set SUPABASE_URL and SUPABASE_SERVICE_KEY"}</li>
            </ul>
          </section>
        </div>
      )}

      {/* ============================================ TEMPLATES */}
      {tab === "templates" && (
        <div className="settings-grid">
          <section className="card">
            <div className="card-head">
              <h2><Mail size={17} /> Stage emails</h2>
              {mayWrite && (
                <button className="btn btn-ghost sm" onClick={() => setEditing({ stage: "ack", name: "", subject: "", body: "" })}>
                  <Plus size={13} /> New
                </button>
              )}
            </div>
            {templates.length === 0 && !editing && (
              <p className="muted small">
                No templates yet — sensible defaults are used for every stage. Add one to override
                the wording.
              </p>
            )}
            {templates.map((t) => (
              <div className="job-row" key={t.id}>
                <div className="job-main">
                  <b className="ellipsis">{t.name}</b>
                  <div className="job-meta">
                    <span><Badge variant="neutral">{STAGE_LABEL[t.stage]}</Badge></span>
                    <span className="ellipsis">{t.subject}</span>
                  </div>
                </div>
                {mayWrite && (
                  <div className="job-actions">
                    <button className="btn btn-ghost sm" onClick={() => setEditing(t)}>Edit</button>
                    <button className="btn btn-ghost sm icon-only danger" title="Delete template"
                      aria-label="Delete template"
                      onClick={async () => {
                        await deleteTemplate(t.id);
                        setTemplates((cur) => cur.filter((x) => x.id !== t.id));
                      }}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}

            {editing && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                <div className="field">
                  <label className="field-label">Name</label>
                  <input className="input" value={editing.name ?? ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">Used for</label>
                  <select className="input" value={editing.stage ?? "custom"}
                    onChange={(e) => setEditing({ ...editing, stage: e.target.value as TemplateStage })}>
                    {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Subject</label>
                  <input className="input" value={editing.subject ?? ""}
                    onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">Body</label>
                  <textarea className="input textarea" rows={9} value={editing.body ?? ""}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                </div>
                <span className="sub-h">Merge fields — click to copy</span>
                <div className="chips" style={{ marginBottom: 14 }}>
                  {MERGE_FIELDS.map((f) => (
                    <button key={f.key} className="chip click" type="button"
                      onClick={() => navigator.clipboard?.writeText(`{{${f.key}}}`)}
                      title={`Copy {{${f.key}}}`}>{f.label}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" onClick={persistTemplate}>Save template</button>
                  <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head"><h2><FileClock size={17} /> Outbox</h2>
              <span className="count-pill">{queue.filter((q) => q.status === "queued").length} queued</span></div>
            {queue.length === 0 ? (
              <p className="muted small">Nothing sent or queued yet.</p>
            ) : queue.slice(0, 15).map((q) => (
              <div className="skill-row" key={q.id}>
                <b className="ellipsis">{q.to_email}</b>
                <span className="ellipsis">{q.subject}</span>
                <Badge variant={q.status === "sent" ? "success" : q.status === "failed" ? "danger"
                        : q.status === "cancelled" ? "neutral" : "info"}>{q.status}</Badge>
              </div>
            ))}
            {queue.some((q) => q.status === "failed") && (
              <p className="hint">
                Failed messages stopped after several retries. The usual cause is Gmail missing
                the send permission — grant it under Connections.
              </p>
            )}
          </section>
        </div>
      )}

      {/* ============================================ AUTOMATION */}
      {tab === "automation" && (
        <section className="card" style={{ maxWidth: 720 }}>
          <div className="card-head"><h2><Radar size={17} /> Auto-screen watches</h2>
            <span className="count-pill">{watches.filter((w) => w.enabled).length} active</span></div>
          {watches.length === 0 && (
            <p className="muted small">
              No watches yet. On the Screen page, open <b>Gmail</b>, pick a label and click{" "}
              <b>Turn on</b> under “Auto-screen this label”.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {watches.map((w) => (
              <div key={w.id} className={`watch-row ${w.enabled ? "" : "off"}`}>
                <div className="watch-main">
                  <b>{w.title || "Untitled role"}</b>
                  <div className="m">
                    {w.label_name || w.label_id} · every {w.interval_min} min · {w.runs} run{w.runs === 1 ? "" : "s"}
                    {w.last_run ? ` · last ${when(w.last_run)} (${w.last_fetched} new)` : ""}
                  </div>
                </div>
                <label className="switch" aria-label={w.enabled ? "Disable watch" : "Enable watch"}>
                  <input type="checkbox" checked={w.enabled} onChange={async () => {
                    try {
                      const u = await updateWatch(w.id, { enabled: !w.enabled });
                      setWatches((ws) => ws.map((x) => (x.id === w.id ? u : x)));
                      refreshReady();
                    } catch (e) { toast.error(msg(e)); }
                  }} />
                  <span className="track" />
                </label>
                <button className="btn btn-ghost sm" onClick={async () => {
                  const id = toast.loading(`Checking “${w.label_name || w.label_id}”…`);
                  try {
                    const r = await runWatch(w.id);
                    setWatches(await listWatches());
                    refreshReady();
                    toast.update(id, r.fetched ? "success" : "info",
                      r.fetched ? `Fetched ${r.fetched} new resume(s) — see the Screen page banner.`
                                : "No new applications right now.", 5000);
                  } catch (e) { toast.update(id, "error", `Run failed: ${msg(e)}`, 6000); }
                }}><Play size={12} /> Run now</button>
                <button className="btn btn-ghost sm icon-only danger" title="Delete watch"
                  aria-label="Delete watch" onClick={async () => {
                    try {
                      await deleteWatch(w.id);
                      setWatches((ws) => ws.filter((x) => x.id !== w.id));
                      refreshReady();
                    } catch (e) { toast.error(msg(e)); }
                  }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <p className="hint">
            Watches live on the backend, so they only run while it is awake. On a free host that
            sleeps, use an external cron to hit <code>/api/admin/retention/run</code> and{" "}
            <code>/api/admin/mail/drain</code> instead.
          </p>
        </section>
      )}

      {/* ============================================ TAXONOMY */}
      {tab === "taxonomy" && (
        <section className="card" style={{ maxWidth: 720 }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <h2><Tags size={17} /> Skill taxonomy</h2>
            <span className="count-pill">{builtinCount} built-in · {Object.keys(custom).length} custom</span>
          </div>
          <p className="muted small" style={{ marginBottom: 16, lineHeight: 1.6 }}>
            Add company-specific tools so they count as matched skills. Aliases are alternative spellings.
          </p>
          <div className="create-row" style={{ marginBottom: 14 }}>
            <input className="input" placeholder="Skill name" value={skillName}
              onChange={(e) => setSkillName(e.target.value)} />
            <input className="input" placeholder="Aliases, comma separated" value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSkill()} />
            <button className="btn btn-primary" onClick={addSkill} disabled={!skillName.trim()}>Add</button>
          </div>
          {Object.entries(custom).map(([n, als]) => (
            <div key={n} className="skill-row">
              <b>{n}</b>{als.length > 0 && <span>· {als.join(", ")}</span>}
              <button className="link-btn danger" onClick={async () => {
                try { setCustom(await removeCustomSkill(n)); toast.success(`Removed “${n}”.`); }
                catch (e) { toast.error(`Couldn't remove: ${msg(e)}`); }
              }}>remove</button>
            </div>
          ))}
          {Object.keys(custom).length === 0 && <div className="muted small">No custom skills yet.</div>}
        </section>
      )}

      {/* ============================================ COMPLIANCE */}
      {tab === "compliance" && (
        <div className="stack">
          <div className="settings-grid">
            <section className="card">
              <div className="card-head"><h2><ShieldCheck size={17} /> Data retention</h2></div>
              <p className="muted small" style={{ marginBottom: 14, lineHeight: 1.6 }}>
                After this long, candidate names, contacts, resumes and cover notes are erased.
                Scores and counts survive, so History and Insights keep working with no personal
                data left in them.
              </p>
              <select className="input" value={retention} disabled={!admin}
                onChange={(e) => saveRetention(Number(e.target.value))} aria-label="Retention window">
                {RETENTION_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
              </select>
              {!admin && <p className="hint">Only an admin can change this.</p>}
              {retention > 0 && (
                <p className="hint">
                  The sweep runs on the backend every few hours. It erases in place rather than
                  deleting rows, so the hiring record stays defensible.
                </p>
              )}
            </section>

            <section className="card">
              <div className="card-head"><h2>Erasure requests</h2>
                <span className="count-pill">{requests.filter((r) => r.status === "pending").length} pending</span></div>
              {mayWrite && (
                <div className="create-row" style={{ marginBottom: 14 }}>
                  <input className="input" type="email" placeholder="candidate@email.com"
                    value={eraseEmail} onChange={(e) => setEraseEmail(e.target.value)} />
                  <button className="btn btn-secondary" onClick={requestErase}>Erase</button>
                </div>
              )}
              {requests.length === 0 ? (
                <p className="muted small">
                  None. Candidates can also request this themselves from their status page.
                </p>
              ) : requests.slice(0, 12).map((r) => (
                <div className="skill-row" key={r.id}>
                  <b className="ellipsis">{r.email}</b>
                  <span>{r.source} · {when(r.requested_at)}</span>
                  <Badge variant={r.status === "completed" ? "success" : r.status === "rejected" ? "neutral" : "warning"}>
                    {r.status}
                  </Badge>
                </div>
              ))}
            </section>
          </div>

          <section className="card">
            <div className="card-head"><h2><FileClock size={17} /> Audit trail</h2>
              <span className="count-pill">last {audit?.length ?? 0}</span></div>
            <p className="muted small" style={{ marginBottom: 14 }}>
              Every status and owner change, written by a database trigger. There is no update or
              delete policy on this table, so it cannot be edited or erased — including by an admin.
            </p>
            {audit === null ? <Spinner /> : audit.length === 0 ? (
              <p className="muted small">Nothing recorded yet.</p>
            ) : (
              <div className="audit">
                {audit.map((e) => (
                  <div className="audit-row" key={e.id}>
                    <span className="audit-when">{when(e.at)}</span>
                    <span className="audit-what">
                      <b>{nameOf(e.actor_id)}</b>{" "}
                      <span>{e.action.replace(/\./g, " ")}</span>
                      {e.candidate_name ? <> · <b>{e.candidate_name}</b></> : null}
                      {(e.after as { status?: string } | null)?.status
                        ? <> → <b>{(e.after as { status?: string }).status}</b></> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ============================================ APPEARANCE */}
      {tab === "appearance" && (
        <section className="card" style={{ maxWidth: 620 }}>
          <div className="card-head"><h2><Palette size={17} /> Appearance &amp; shortcuts</h2></div>
          <SegTabs value={theme} onChange={(t) => { setTheme(t); applyTheme(t); }} items={[
            { value: "dark", label: <><Moon size={14} /> Dark</> },
            { value: "light", label: <><Sun size={14} /> Light</> },
          ]} />
          <p className="shortcuts" style={{ marginTop: 16 }}>
            In the shortlist: <kbd>j</kbd> <kbd>k</kbd> move · <kbd>↵</kbd> open · <kbd>s</kbd> shortlist ·{" "}
            <kbd>r</kbd> reject · <kbd>i</kbd> interview · <kbd>a</kbd> anonymize · <kbd>⌘K</kbd> command palette.
          </p>
          <div className="link-box" style={{ marginTop: 16 }}>
            <Link2 size={13} />
            <code>{org?.name ?? "This team"} · {ROLE_LABEL[(role ?? "viewer") as Role]}</code>
          </div>
        </section>
      )}
    </div>
  );
}
