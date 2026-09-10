/* Applications inbox — everything that arrived through a public apply link,
   already parsed and scored against that role's description. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink, Inbox as InboxIcon, Link2, Mail, MapPin, Phone, Search, Send, Wallet,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../components/Toast";
import { EmptyState, SkeletonRows } from "../components/ui";
import { Avatar, Badge, Eyebrow, initialsOf, scoreClass, statusVariant } from "../components/ds";
import { Sidebar, useWorkspace } from "../context/Workspace";
import { render as renderTemplate, contextFor } from "../lib/merge";
import {
  STATUSES, canWrite, enqueueEmails, listApplications, listJobs, logAudit,
  setApplicationStatus, signedResumeUrl, type Application, type JobRow, type ReviewStatus,
} from "../lib/db";
import { supabase } from "../lib/supabase";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New", shortlisted: "Shortlisted", interview: "Interview", rejected: "Rejected", hired: "Hired",
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Inbox() {
  const { user, configured } = useAuth();
  const { orgId, org, role, ready } = useWorkspace();
  const toast = useToast();
  const mayWrite = canWrite(role);

  const [apps, setApps] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReviewStatus>("all");
  const [open, setOpen] = useState<Application | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    try {
      const [a, j] = await Promise.all([listApplications(orgId), listJobs(orgId)]);
      setApps(a); setJobs(j);
    } catch (e) {
      toast.error(`Couldn't load applications: ${e instanceof Error ? e.message : ""}`);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const jobTitle = useCallback(
    (id: string) => jobs.find((j) => j.id === id)?.title ?? "Unknown role",
    [jobs]
  );

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return apps.filter((a) => {
      if (jobFilter && a.job_id !== jobFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!t) return true;
      return `${a.name} ${a.email} ${a.current_company ?? ""} ${a.current_title ?? ""} ${a.location ?? ""}`
        .toLowerCase().includes(t);
    });
  }, [apps, q, jobFilter, statusFilter]);

  async function setStatus(a: Application, status: ReviewStatus) {
    try {
      await setApplicationStatus(a.id, status);
      setApps((cur) => cur.map((x) => (x.id === a.id ? { ...x, status } : x)));
      if (open?.id === a.id) setOpen({ ...a, status });
      if (orgId && user) {
        logAudit(orgId, user.id, "application.status", "application",
                 { entity_id: a.id, candidate_name: a.name, after: { status } });
      }
      if (status === "interview") {
        toast.success(`${a.name} moved to Interview — they can now book a slot from their status page.`, 6000);
      }
    } catch (e) { toast.error(`Couldn't update: ${e instanceof Error ? e.message : ""}`); }
  }

  async function viewResume(a: Application) {
    if (!a.resume_id) return toast.info("No stored resume for this application.");
    const id = toast.loading("Fetching the resume…");
    try {
      const { data, error } = await supabase.from("resume_files")
        .select("storage_path").eq("id", a.resume_id).single();
      if (error) throw new Error(error.message);
      const url = await signedResumeUrl(data.storage_path);
      toast.dismiss(id);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.update(id, "error", `Couldn't open it: ${e instanceof Error ? e.message : ""}`, 6000);
    }
  }

  async function emailSelected(stage: ReviewStatus) {
    if (!orgId || !user) return;
    const chosen = apps.filter((a) => selected.has(a.id));
    if (!chosen.length) return;
    const tplSubject = stage === "rejected"
      ? "Update on your application — {{job_title}}"
      : "Your application for {{job_title}}";
    const tplBody = stage === "rejected"
      ? "Hi {{first_name}},\n\nThank you for applying for {{job_title}}. After careful review we've decided to move forward with other candidates.\n\nWe appreciate your interest and wish you the best.\n\nBest regards\n{{company}} hiring team"
      : "Hi {{first_name}},\n\nGood news — we've shortlisted you for {{job_title}} and would like to take this further.\n\nYou can see your status and pick an interview slot here:\n{{status_link}}\n\nBest regards\n{{company}} hiring team";

    try {
      const items = chosen.map((a) => {
        const ctx = contextFor(
          { name: a.name, email: a.email, score: a.score ?? 0, location: a.location ?? "" },
          {
            jobTitle: jobTitle(a.job_id),
            company: org?.name ?? "",
            recruiter: (user.user_metadata?.full_name as string) ?? "",
            statusLink: `${window.location.origin}/status/${a.status_token}`,
          }
        );
        return {
          to_email: a.email, to_name: a.name,
          subject: renderTemplate(tplSubject, ctx),
          body: renderTemplate(tplBody, ctx),
          application_id: a.id,
        };
      });
      const n = await enqueueEmails(orgId, user.id, items);
      logAudit(orgId, user.id, "email.queued", "application", { after: { count: n, stage } });
      await Promise.all(chosen.map((a) => setStatus(a, stage)));
      setSelected(new Set());
      toast.success(
        ready?.gmail_can_send
          ? `${n} email${n === 1 ? "" : "s"} queued — the server sends them within a minute.`
          : `${n} email${n === 1 ? "" : "s"} queued. They'll send once Gmail has the send permission (Settings → Connections).`,
        7000
      );
    } catch (e) { toast.error(`Couldn't queue emails: ${e instanceof Error ? e.message : ""}`); }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  if (!configured) {
    return <div className="page"><EmptyState icon={<InboxIcon size={26} />} title="The inbox needs history"
      body={<>Add Supabase keys to <code>frontend/.env</code> to receive applications.</>} /></div>;
  }
  if (loading) return <div className="page"><div className="card"><SkeletonRows rows={6} /></div></div>;

  const live = jobs.filter((j) => j.apply_enabled);
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: apps.filter((a) => a.status === s).length }),
                                 {} as Record<ReviewStatus, number>);

  return (
    <div className="page">
      <Sidebar>
        <div>
          <Eyebrow>Filter</Eyebrow>
          <div className="input-ico">
            <Search size={15} />
            <input className="input" placeholder="Name, email, company…" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Search applications" />
          </div>
        </div>
        <div>
          <Eyebrow>Role</Eyebrow>
          <select className="input" value={jobFilter} onChange={(e) => setJobFilter(e.target.value)} aria-label="Filter by role">
            <option value="">All roles</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        <div>
          <Eyebrow>Stage</Eyebrow>
          <div className="ctx-list">
            <button className={`ctx-item ${statusFilter === "all" ? "on" : ""}`} onClick={() => setStatusFilter("all")}>
              <span>All applications</span><b>{apps.length}</b>
            </button>
            {STATUSES.map((s) => (
              <button key={s} className={`ctx-item ${statusFilter === s ? "on" : ""}`}
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}>
                <span>{STATUS_LABEL[s]}</span><b>{counts[s]}</b>
              </button>
            ))}
          </div>
        </div>
        {live.length > 0 && (
          <div>
            <Eyebrow>Live apply links</Eyebrow>
            {live.map((j) => (
              <div className="link-box" key={j.id} style={{ marginBottom: 6 }}>
                <Link2 size={12} />
                <code>{j.title}</code>
                <a className="link-btn" href={`/apply/${j.public_token}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={11} />
                </a>
              </div>
            ))}
          </div>
        )}
        {live.length === 0 && (
          <div className="notice">
            <b>No apply links are live.</b> Turn one on under Jobs to start receiving applications here.
          </div>
        )}
      </Sidebar>

      {apps.length === 0 ? (
        <EmptyState icon={<InboxIcon size={26} />} title="No applications yet"
          body="Turn on an apply link under Jobs and share it. Applications arrive here already parsed and scored against that role."
          action={<a className="btn btn-primary" href="/jobs">Go to Jobs</a>} />
      ) : (
        <>
          {selected.size > 0 && mayWrite && (
            <div className="bulkbar">
              <span>{selected.size} selected</span>
              <span className="grow" />
              <button className="btn btn-ghost sm" onClick={() => emailSelected("shortlisted")}>
                <Send size={13} /> Shortlist &amp; email
              </button>
              <button className="btn btn-ghost sm danger" onClick={() => emailSelected("rejected")}>
                <Send size={13} /> Decline &amp; email
              </button>
              <button className="link-btn muted" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          <div className="card">
            {rows.length === 0 && <p className="muted small">Nothing matches those filters.</p>}
            {rows.map((a) => (
              <div className="job-row" key={a.id}>
                <div className="job-main" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {mayWrite && (
                    <input type="checkbox" className="check" checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)} aria-label={`Select ${a.name}`} style={{ marginTop: 4 }} />
                  )}
                  <Avatar initials={initialsOf(a.name || a.email)} tone="slate" size={36} />
                  <div style={{ minWidth: 0 }}>
                    <b className="ellipsis">{a.name}</b>
                    <div className="job-meta">
                      <span><Mail size={11} style={{ verticalAlign: -1 }} /> {a.email}</span>
                      {a.phone && <span><Phone size={11} style={{ verticalAlign: -1 }} /> {a.phone}</span>}
                      {a.location && <span><MapPin size={11} style={{ verticalAlign: -1 }} /> {a.location}</span>}
                      {a.expected_salary && <span><Wallet size={11} style={{ verticalAlign: -1 }} /> {a.expected_salary}</span>}
                    </div>
                    <div className="job-meta">
                      <span>{jobTitle(a.job_id)}</span>
                      <span>{when(a.created_at)}</span>
                      {a.current_title && <span>{a.current_title}{a.current_company ? ` at ${a.current_company}` : ""}</span>}
                      {a.notice_period && <span>notice: {a.notice_period}</span>}
                    </div>
                  </div>
                </div>
                <div className="job-actions">
                  {a.score != null && (
                    <b className={`sc-${scoreClass(a.score)}`} style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>
                      {a.score}
                    </b>
                  )}
                  <Badge variant={statusVariant(a.status)}>{STATUS_LABEL[a.status]}</Badge>
                  <button className="btn btn-ghost sm" onClick={() => setOpen(a)}>Details</button>
                  {a.resume_id && (
                    <button className="btn btn-ghost sm" onClick={() => viewResume(a)}>Resume</button>
                  )}
                  {mayWrite && (
                    <select className="input" style={{ width: 128, height: 34, fontSize: 12.5 }}
                      value={a.status} onChange={(e) => setStatus(a, e.target.value as ReviewStatus)}
                      aria-label={`Stage for ${a.name}`}>
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <div className="modal-scrim" onClick={() => setOpen(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
            aria-label={`${open.name} application`}>
            <div className="card-head">
              <h2>{open.name}</h2>
              <button className="btn btn-ghost sm" onClick={() => setOpen(null)}>Close</button>
            </div>

            <div className="facts" style={{ marginBottom: 16 }}>
              {open.score != null && <div className="fact"><b className={`sc-${scoreClass(open.score)}`}>{open.score}</b><span>match</span></div>}
              <div className="fact"><b>{jobTitle(open.job_id)}</b><span>role</span></div>
              <div className="fact"><b>{STATUS_LABEL[open.status]}</b><span>stage</span></div>
              {open.notice_period && <div className="fact"><b>{open.notice_period}</b><span>notice</span></div>}
              {open.expected_salary && <div className="fact"><b>{open.expected_salary}</b><span>expects</span></div>}
            </div>

            {open.cover_note && (
              <>
                <span className="sub-h">Cover note</span>
                <p className="cmt-text" style={{ marginBottom: 16 }}>{open.cover_note}</p>
              </>
            )}

            {(open.matched_skills?.length || open.missing_skills?.length) && (
              <div className="two-col" style={{ marginBottom: 16 }}>
                <div>
                  <span className="sub-h ok">Matched</span>
                  <div className="chips">
                    {(open.matched_skills ?? []).map((s) => <span key={s} className="chip matched">{s}</span>)}
                    {!open.matched_skills?.length && <span className="muted small">none</span>}
                  </div>
                </div>
                <div>
                  <span className="sub-h">Missing</span>
                  <div className="chips">
                    {(open.missing_skills ?? []).map((s) => <span key={s} className="chip missing">{s}</span>)}
                    {!open.missing_skills?.length && <span className="muted small">none</span>}
                  </div>
                </div>
              </div>
            )}

            {Object.keys(open.links ?? {}).length > 0 && (
              <>
                <span className="sub-h">Links</span>
                <div className="chips" style={{ marginBottom: 16 }}>
                  {Object.entries(open.links).map(([k, v]) => (
                    <a key={k} className="chip click" href={v} target="_blank" rel="noreferrer">{k}</a>
                  ))}
                </div>
              </>
            )}

            <div className="link-box">
              <Link2 size={13} />
              <code>{window.location.origin}/status/{open.status_token}</code>
              <button className="link-btn" onClick={() => navigator.clipboard?.writeText(
                `${window.location.origin}/status/${open.status_token}`)}>Copy</button>
            </div>
            <p className="hint">
              The candidate's own status page. It shows their stage and interview slots — never their score.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
