/* Jobs & interviews — open roles, their public apply links, interview slots you
   offer candidates, and everything they've booked. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase, CalendarClock, CalendarPlus, Check, Copy, ExternalLink, Link2,
  Plus, Trash2, Users, X,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { EmptyState, SkeletonCard } from "../components/ui";
import { Badge, Eyebrow, SegTabs } from "../components/ds";
import { Sidebar, useWorkspace, useMemberName } from "../context/Workspace";
import {
  applyUrl, canWrite, createSlots, deleteJob, deleteSlot, listApplications, listInterviews,
  listJobs, listSlots, logAudit, saveJob, setInterviewStatus,
  type Application, type Interview, type InterviewSlot, type JobRow,
} from "../lib/db";

type Tab = "roles" | "slots" | "booked";

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function Jobs() {
  const { user, configured } = useAuth();
  const { orgId, role, ready } = useWorkspace();
  const toast = useToast();
  const nameOf = useMemberName();
  const mayWrite = canWrite(role);

  const [tab, setTab] = useState<Tab>("roles");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [slots, setSlots] = useState<InterviewSlot[]>([]);
  const [booked, setBooked] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState("");

  // slot composer
  const [slotJob, setSlotJob] = useState("");
  const [slotDate, setSlotDate] = useState("");
  const [slotTimes, setSlotTimes] = useState("10:00, 11:00, 14:00");
  const [slotMode, setSlotMode] = useState<"video" | "phone" | "onsite">("video");
  const [slotLink, setSlotLink] = useState("");
  const [slotLen, setSlotLen] = useState(45);

  const reload = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    try {
      const [j, a, s, b] = await Promise.all([
        listJobs(orgId), listApplications(orgId), listSlots(orgId), listInterviews(orgId),
      ]);
      setJobs(j); setApps(a); setSlots(s); setBooked(b);
      if (!slotJob && j.length) setSlotJob(j[0].id);
    } catch (e) {
      toast.error(`Couldn't load jobs: ${e instanceof Error ? e.message : ""}`);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const appCount = useMemo(() => {
    const m = new Map<string, number>();
    apps.forEach((a) => m.set(a.job_id, (m.get(a.job_id) ?? 0) + 1));
    return m;
  }, [apps]);

  async function toggleApply(j: JobRow) {
    if (!user || !orgId) return;
    try {
      const row = await saveJob(orgId, user.id, {
        id: j.id, title: j.title, description: j.description, top_n: j.top_n,
        apply_enabled: !j.apply_enabled,
      });
      setJobs((cur) => cur.map((x) => (x.id === row.id ? row : x)));
      logAudit(orgId, user.id, row.apply_enabled ? "apply.enabled" : "apply.disabled", "job",
               { entity_id: row.id, after: { title: row.title } });
      toast.success(row.apply_enabled
        ? "Apply link is live. Share it and applications land in your Inbox."
        : "Apply link switched off. The page now says the role is closed.");
    } catch (e) { toast.error(`Couldn't update: ${e instanceof Error ? e.message : ""}`); }
  }

  async function toggleOpen(j: JobRow) {
    if (!user || !orgId) return;
    try {
      const row = await saveJob(orgId, user.id, {
        id: j.id, title: j.title, description: j.description, top_n: j.top_n,
        is_open: !j.is_open,
      });
      setJobs((cur) => cur.map((x) => (x.id === row.id ? row : x)));
    } catch (e) { toast.error(`Couldn't update: ${e instanceof Error ? e.message : ""}`); }
  }

  async function remove(j: JobRow) {
    const n = appCount.get(j.id) ?? 0;
    const msg = n
      ? `Delete “${j.title}”? Its ${n} application${n === 1 ? "" : "s"} will be deleted too. This cannot be undone.`
      : `Delete “${j.title}”?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteJob(j.id);
      setJobs((cur) => cur.filter((x) => x.id !== j.id));
      toast.success("Job deleted.");
    } catch (e) { toast.error(`Couldn't delete: ${e instanceof Error ? e.message : ""}`); }
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(""), 1800);
    } catch { toast.info(text, 8000); }
  }

  async function addSlots() {
    if (!user || !orgId) return;
    if (!slotDate) return toast.error("Pick a date first.");
    const times = slotTimes.split(",").map((t) => t.trim()).filter(Boolean);
    if (!times.length) return toast.error("Add at least one time, e.g. 10:00.");
    const rows = times.map((t) => {
      const dt = new Date(`${slotDate}T${t.length === 5 ? t : t.padStart(5, "0")}:00`);
      return {
        job_id: slotJob || null,
        starts_at: dt.toISOString(),
        duration_min: slotLen,
        mode: slotMode,
        meeting_link: slotLink.trim() || null,
        location: slotMode === "onsite" ? slotLink.trim() || null : null,
        interviewer_id: user.id,
      };
    }).filter((r) => !isNaN(new Date(r.starts_at).getTime()));
    if (!rows.length) return toast.error("Those times didn't parse. Use 24-hour HH:MM.");
    try {
      const made = await createSlots(orgId, user.id, rows);
      setSlots((cur) => [...cur, ...made].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      toast.success(`${made.length} slot${made.length === 1 ? "" : "s"} offered. Candidates at the interview stage can book them.`);
    } catch (e) { toast.error(`Couldn't add slots: ${e instanceof Error ? e.message : ""}`); }
  }

  async function dropSlot(s: InterviewSlot) {
    try {
      await deleteSlot(s.id);
      setSlots((cur) => cur.filter((x) => x.id !== s.id));
    } catch (e) { toast.error(`Couldn't remove: ${e instanceof Error ? e.message : ""}`); }
  }

  async function markInterview(i: Interview, status: Interview["status"]) {
    try {
      await setInterviewStatus(i.id, status);
      setBooked((cur) => cur.map((x) => (x.id === i.id ? { ...x, status } : x)));
    } catch (e) { toast.error(`Couldn't update: ${e instanceof Error ? e.message : ""}`); }
  }

  if (!configured) {
    return <div className="page"><EmptyState icon={<Briefcase size={26} />} title="Jobs need history"
      body={<>Add Supabase keys to <code>frontend/.env</code> to manage roles and apply links.</>} /></div>;
  }
  if (loading) return <div className="page stack"><SkeletonCard lines={4} /><SkeletonCard lines={4} /></div>;

  const jobTitle = (id: string | null) => jobs.find((j) => j.id === id)?.title ?? "—";
  const openSlots = slots.filter((s) => !s.taken_by);
  const upcoming = booked.filter((b) => b.status === "scheduled");

  return (
    <div className="page">
      <Sidebar>
        <div>
          <Eyebrow>At a glance</Eyebrow>
          <div className="facts">
            <div className="fact"><b>{jobs.filter((j) => j.is_open).length}</b><span>open roles</span></div>
            <div className="fact"><b>{jobs.filter((j) => j.apply_enabled).length}</b><span>apply links</span></div>
            <div className="fact"><b>{apps.length}</b><span>applications</span></div>
            <div className="fact"><b>{openSlots.length}</b><span>free slots</span></div>
            <div className="fact"><b>{upcoming.length}</b><span>booked</span></div>
          </div>
        </div>
        {!ready?.public_apply && (
          <div className="notice warn">
            <b>Apply links need the server configured.</b> Set <code>SUPABASE_URL</code> and{" "}
            <code>SUPABASE_SERVICE_KEY</code> on the backend so the public form can save applications.
          </div>
        )}
        {!mayWrite && <div className="notice"><b>Read-only.</b> Your role can view jobs but not change them.</div>}
        <div className="notice">
          <b>How apply links work.</b> Turn one on and share the URL. Each application is
          parsed and scored against that job description the moment it arrives.
        </div>
      </Sidebar>

      <div className="tabs" role="tablist">
        {([["roles", "Roles"], ["slots", "Interview slots"], ["booked", "Booked interviews"]] as [Tab, string][])
          .map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k}
              className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{label}</button>
          ))}
      </div>

      {tab === "roles" && (
        <section className="card">
          <div className="card-head">
            <h2><Briefcase size={17} /> Open roles</h2>
            <span className="count-pill">{jobs.length} saved</span>
          </div>
          {jobs.length === 0 ? (
            <p className="muted small">
              No saved roles yet. On the Screen page, paste a job description and click <b>Save</b>.
            </p>
          ) : jobs.map((j) => (
            <div className="job-row" key={j.id}>
              <div className="job-main">
                <b className="ellipsis">{j.title}</b>
                <div className="job-meta">
                  <span>{j.is_open ? <Badge variant="success">Open</Badge> : <Badge variant="neutral">Closed</Badge>}</span>
                  {j.location && <span>{j.location}</span>}
                  {j.employment_type && <span>{j.employment_type}</span>}
                  <span>{j.headcount} opening{j.headcount === 1 ? "" : "s"}</span>
                  <span><Users size={11} style={{ verticalAlign: -1 }} /> {appCount.get(j.id) ?? 0} applied</span>
                </div>
                {j.apply_enabled && (
                  <div className="link-box" style={{ marginTop: 10 }}>
                    <Link2 size={13} />
                    <code>{applyUrl(j.public_token)}</code>
                    <button className="link-btn" onClick={() => copy(applyUrl(j.public_token), j.id)}>
                      {copied === j.id ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                    </button>
                    <a className="link-btn" href={applyUrl(j.public_token)} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> Open
                    </a>
                  </div>
                )}
              </div>
              <div className="job-actions">
                <label className="switch" title="Accept public applications">
                  <input type="checkbox" checked={j.apply_enabled} disabled={!mayWrite}
                    onChange={() => toggleApply(j)} />
                  <span className="track" /><span className="switch-label">Apply link</span>
                </label>
                <button className="btn btn-ghost sm" disabled={!mayWrite} onClick={() => toggleOpen(j)}>
                  {j.is_open ? "Close role" : "Reopen"}
                </button>
                <button className="btn btn-ghost sm icon-only danger" disabled={!mayWrite}
                  onClick={() => remove(j)} title="Delete role" aria-label="Delete role">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "slots" && (
        <div className="stack">
          {mayWrite && (
            <section className="card">
              <div className="card-head"><h2><CalendarPlus size={17} /> Offer interview slots</h2></div>
              <div className="pub-grid">
                <div className="field">
                  <label className="field-label">Role</label>
                  <select className="input" value={slotJob} onChange={(e) => setSlotJob(e.target.value)}>
                    <option value="">Any role</option>
                    {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Date</label>
                  <input className="input" type="date" value={slotDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setSlotDate(e.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Times (24-hour, comma separated)</label>
                  <input className="input" value={slotTimes} onChange={(e) => setSlotTimes(e.target.value)}
                    placeholder="10:00, 11:00, 14:30" />
                </div>
                <div className="field">
                  <label className="field-label">Length</label>
                  <select className="input" value={slotLen} onChange={(e) => setSlotLen(Number(e.target.value))}>
                    {[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Format</label>
                  <SegTabs value={slotMode} onChange={setSlotMode} items={[
                    { value: "video", label: "Video" }, { value: "phone", label: "Phone" }, { value: "onsite", label: "Onsite" },
                  ]} />
                </div>
                <div className="field">
                  <label className="field-label">{slotMode === "onsite" ? "Address" : "Meeting link"}</label>
                  <input className="input" value={slotLink} onChange={(e) => setSlotLink(e.target.value)}
                    placeholder={slotMode === "onsite" ? "Office address" : "https://meet.example.com/…"} />
                </div>
              </div>
              <button className="btn btn-primary" onClick={addSlots}><Plus size={15} /> Offer these slots</button>
              <p className="hint">
                Times are read in your own timezone and stored in UTC. Candidates at the interview
                stage see the free ones on their status page and book one themselves.
              </p>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <h2><CalendarClock size={17} /> Slots</h2>
              <span className="count-pill">{openSlots.length} free · {slots.length - openSlots.length} taken</span>
            </div>
            {slots.length === 0 ? (
              <p className="muted small">No slots yet.</p>
            ) : (
              <div className="slot-grid">
                {slots.map((s) => (
                  <div className={`slot ${s.taken_by ? "taken" : ""}`} key={s.id}>
                    <div className="slot-when">
                      <b>{when(s.starts_at)}</b>
                      <span>{s.duration_min} min · {s.mode} · {jobTitle(s.job_id)}</span>
                    </div>
                    {s.taken_by
                      ? <Badge variant="success">Booked</Badge>
                      : mayWrite && (
                        <button className="icon-btn sm danger" onClick={() => dropSlot(s)}
                          aria-label="Remove slot" title="Remove slot"><X size={13} /></button>
                      )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "booked" && (
        <section className="card">
          <div className="card-head">
            <h2><CalendarClock size={17} /> Booked interviews</h2>
            <span className="count-pill">{upcoming.length} upcoming</span>
          </div>
          {booked.length === 0 ? (
            <p className="muted small">
              Nothing booked yet. Move a candidate to <b>Interview</b> and offer slots — they book themselves
              and get a calendar invite.
            </p>
          ) : booked.map((i) => (
            <div className="job-row" key={i.id}>
              <div className="job-main">
                <b className="ellipsis">{i.candidate_name || i.candidate_email || "Candidate"}</b>
                <div className="job-meta">
                  <span>{when(i.starts_at)}</span>
                  <span>{i.duration_min} min · {i.mode}</span>
                  <span>{jobTitle(i.job_id)}</span>
                  {i.interviewer_ids?.length ? <span>with {nameOf(i.interviewer_ids[0])}</span> : null}
                </div>
                {(i.meeting_link || i.location) && (
                  <div className="link-box" style={{ marginTop: 10 }}>
                    <Link2 size={13} /><code>{i.meeting_link || i.location}</code>
                  </div>
                )}
              </div>
              <div className="job-actions">
                <Badge variant={i.status === "scheduled" ? "info" : i.status === "completed" ? "success"
                        : i.status === "cancelled" ? "danger" : "neutral"}>
                  {i.status.replace("_", " ")}
                </Badge>
                {i.status === "scheduled" && mayWrite && (
                  <>
                    <button className="btn btn-ghost sm" onClick={() => markInterview(i, "completed")}>Done</button>
                    <button className="btn btn-ghost sm danger" onClick={() => markInterview(i, "cancelled")}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
