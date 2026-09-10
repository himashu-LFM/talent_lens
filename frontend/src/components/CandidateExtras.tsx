/* Candidate-detail panels that need team or profile data: career timeline,
   LLM second opinion, discussion thread, owner picker, decision history. */
import { useEffect, useState } from "react";
import {
  AlertTriangle, Bot, CalendarRange, Check, GraduationCap, History, MessageSquare,
  Send, Trash2, UserCheck,
} from "lucide-react";
import type { AIAssessment, CareerProfile } from "../api";
import {
  addComment, deleteComment, listCandidateAudit, listComments,
  type AuditEntry, type Comment,
} from "../lib/db";
import { useWorkspace, useMemberName } from "../context/Workspace";
import { useAuth } from "../auth/AuthProvider";
import { Avatar, initialsOf } from "./ds";
import { Spinner } from "./ui";
import { useToast } from "./Toast";

/* ------------------------------------------------------------------ dates */
function monthLabel(ym: string): string {
  if (!ym) return "";
  if (ym === "present") return "Present";
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m || 1) - 1, 1);
  return isNaN(d.getTime()) ? ym : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
function duration(months: number): string {
  if (months < 1) return "<1 mo";
  const y = Math.floor(months / 12), m = months % 12;
  if (!y) return `${m} mo`;
  if (!m) return `${y} yr${y === 1 ? "" : "s"}`;
  return `${y}y ${m}m`;
}
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* ------------------------------------------------------- career timeline */
export function CareerTimeline({ profile }: { profile: CareerProfile }) {
  const roles = profile.roles ?? [];
  if (!roles.length && !profile.education_level) return null;

  const gapAfter = new Map<string, { months: number }>();
  for (const g of profile.gaps ?? []) gapAfter.set(g.to, { months: g.months });

  return (
    <section className="insight">
      <h4 className="section-h"><CalendarRange size={14} /> Career history</h4>

      <div className="facts" style={{ marginBottom: 14 }}>
        {profile.total_months > 0 && (
          <div className="fact"><b>{duration(profile.total_months)}</b><span>total</span></div>
        )}
        {profile.role_count > 0 && (
          <div className="fact"><b>{profile.role_count}</b><span>roles</span></div>
        )}
        {profile.avg_tenure_months > 0 && (
          <div className="fact"><b>{duration(profile.avg_tenure_months)}</b><span>avg tenure</span></div>
        )}
        {profile.seniority && (
          <div className="fact"><b style={{ textTransform: "capitalize" }}>{profile.seniority}</b><span>seniority</span></div>
        )}
        {profile.education_level && (
          <div className="fact"><b style={{ textTransform: "capitalize" }}>{profile.education_level}</b><span>education</span></div>
        )}
      </div>

      {(profile.flags ?? []).length > 0 && (
        <ul className="flag-list" style={{ marginBottom: 14 }}>
          {profile.flags.map((f) => (
            <li key={f}><AlertTriangle size={14} /><span>{f}</span></li>
          ))}
        </ul>
      )}

      <div className="timeline">
        {roles.map((r, i) => (
          <div key={`${r.start}-${i}`}>
            <div className="tl-row">
              <div className="tl-when">
                {monthLabel(r.start)} — {monthLabel(r.end)}
                <div className="tl-dur">{duration(r.months)}</div>
              </div>
              <div className="tl-what">
                <b className="ellipsis" title={r.title || undefined}>{r.title || "Role not detected"}</b>
                <span className="ellipsis" title={r.company || undefined}>
                  {r.company || "Employer not detected"}{r.current ? " · current" : ""}
                </span>
              </div>
            </div>
            {gapAfter.has(r.start) && (
              <div className="tl-gap">
                <AlertTriangle size={13} /> {duration(gapAfter.get(r.start)!.months)} gap before this role
              </div>
            )}
          </div>
        ))}
      </div>

      {(profile.education ?? []).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span className="sub-h"><GraduationCap size={12} style={{ verticalAlign: -2 }} /> Education</span>
          <div className="timeline">
            {profile.education.map((e, i) => (
              <div className="tl-row" key={i}>
                <div className="tl-when">{e.year ?? ""}</div>
                <div className="tl-what"><span>{e.text}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="hint">Read from the dates in the resume. Verify anything you'd act on.</p>
    </section>
  );
}

/* ---------------------------------------------------- LLM second opinion */
const VERDICT_LABEL: Record<string, string> = {
  strong_yes: "Strong yes", yes: "Yes", maybe: "Maybe", no: "No",
};

export function AIAssessmentCard({ ai }: { ai: AIAssessment }) {
  if (ai.error) {
    return (
      <section className="insight warn">
        <h4 className="section-h"><Bot size={14} /> AI second opinion</h4>
        <p className="muted small">{ai.error}</p>
      </section>
    );
  }
  return (
    <section className="insight">
      <h4 className="section-h">
        <Bot size={14} /> AI second opinion
        {ai.model && <span className="r muted small" style={{ textTransform: "none" }}>{ai.model}</span>}
      </h4>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {ai.verdict && (
          <span className={`ai-verdict ai-${ai.verdict}`}>{VERDICT_LABEL[ai.verdict] ?? ai.verdict}</span>
        )}
        {typeof ai.fit_score === "number" && (
          <span className="muted small">independent fit {ai.fit_score}/100</span>
        )}
        {ai.seniority && (
          <span className="muted small">reads as {ai.seniority}</span>
        )}
      </div>
      {ai.summary && <p className="insight-lead">{ai.summary}</p>}
      <div className="two-col" style={{ marginTop: 12 }}>
        {(ai.strengths ?? []).length > 0 && (
          <div>
            <span className="sub-h ok">Strengths</span>
            <ul className="flag-list">{ai.strengths!.map((s, i) => <li key={i}><Check size={13} /><span>{s}</span></li>)}</ul>
          </div>
        )}
        {(ai.concerns ?? []).length > 0 && (
          <div>
            <span className="sub-h">Concerns</span>
            <ul className="flag-list">{ai.concerns!.map((s, i) => <li key={i}><AlertTriangle size={13} /><span>{s}</span></li>)}</ul>
          </div>
        )}
      </div>
      {(ai.evidence ?? []).length > 0 && (
        <div style={{ marginTop: 12 }}>
          {ai.evidence!.map((e, i) => (
            <div className="evi" key={i}><p>“{e}”</p></div>
          ))}
        </div>
      )}
      {(ai.questions ?? []).length > 0 && (
        <>
          <span className="sub-h" style={{ marginTop: 14 }}>Questions this raises</span>
          <ol className="q-list">{ai.questions!.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </>
      )}
      <p className="hint">A model's opinion, not a decision. The offline score is unchanged by it.</p>
    </section>
  );
}

/* ------------------------------------------------------------- assignment */
export function OwnerPicker({ value, onChange, disabled }: {
  value: string | null; onChange: (id: string | null) => void; disabled?: boolean;
}) {
  const { members } = useWorkspace();
  return (
    <section>
      <div className="section-h"><UserCheck size={14} /> Owner</div>
      <select
        className="input"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Assign this candidate to a teammate"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>{m.full_name || m.email || "Teammate"}</option>
        ))}
      </select>
    </section>
  );
}

/* --------------------------------------------------------- comment thread */
export function CommentThread({ runId, candidateKey, canComment }: {
  runId: string | null; candidateKey: string; canComment: boolean;
}) {
  const { user } = useAuth();
  const { orgId } = useWorkspace();
  const nameOf = useMemberName();
  const toast = useToast();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!runId) { setItems([]); return; }
    let live = true;
    setItems(null);
    listComments(runId, candidateKey)
      .then((c) => { if (live) setItems(c); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [runId, candidateKey]);

  async function post() {
    const body = draft.trim();
    if (!body || !runId || !user || !orgId) return;
    setBusy(true);
    try {
      const row = await addComment(orgId, runId, candidateKey, user.id, body);
      setItems((cur) => [...(cur ?? []), row]);
      setDraft("");
    } catch (e) {
      toast.error(`Couldn't post: ${e instanceof Error ? e.message : ""}`);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try {
      await deleteComment(id);
      setItems((cur) => (cur ?? []).filter((c) => c.id !== id));
    } catch (e) {
      toast.error(`Couldn't delete: ${e instanceof Error ? e.message : ""}`);
    }
  }

  return (
    <section className="insight">
      <h4 className="section-h">
        <MessageSquare size={14} /> Discussion
        {items?.length ? <span className="r muted small" style={{ textTransform: "none" }}>{items.length}</span> : null}
      </h4>

      {!runId && <p className="muted small">Save this run to history to discuss candidates with your team.</p>}

      {runId && items === null && <Spinner />}

      {runId && items && items.length === 0 && (
        <p className="muted small">No comments yet. What did you make of them?</p>
      )}

      {runId && items && items.length > 0 && (
        <div className="thread" style={{ marginBottom: canComment ? 14 : 0 }}>
          {items.map((c) => {
            const who = c.author?.full_name || c.author?.email || nameOf(c.author_id);
            return (
              <div className="cmt" key={c.id}>
                <Avatar initials={initialsOf(who)} tone="slate" size={30} />
                <div className="cmt-body">
                  <div className="cmt-head">
                    <b>{who}</b>
                    <time dateTime={c.created_at}>{ago(c.created_at)}</time>
                    {user?.id === c.author_id && (
                      <button className="link-btn danger" onClick={() => remove(c.id)} aria-label="Delete comment">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div className="cmt-text">{c.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {runId && canComment && (
        <div className="cmt-compose">
          <textarea
            className="input textarea" rows={2} value={draft}
            placeholder="Add a note for your team…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }}
            style={{ minHeight: 60 }}
          />
          <button className="btn btn-primary sm" onClick={post} disabled={busy || !draft.trim()} aria-label="Post comment">
            <Send size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- audit trail */
const ACTION_LABEL: Record<string, string> = {
  "status.set": "set the status to",
  "status.change": "changed the status to",
  "assignee.change": "changed the owner",
  "notes.edit": "edited the notes",
  "email.sent": "emailed the candidate",
  "export.excel": "exported the shortlist",
};

export function DecisionHistory({ runId, candidateKey }: { runId: string | null; candidateKey: string }) {
  const nameOf = useMemberName();
  const [items, setItems] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    if (!runId) { setItems([]); return; }
    let live = true;
    listCandidateAudit(runId, candidateKey)
      .then((r) => { if (live) setItems(r); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [runId, candidateKey]);

  if (!runId || !items?.length) return null;

  return (
    <section className="insight">
      <h4 className="section-h"><History size={14} /> Decision history</h4>
      <div className="audit">
        {items.map((e) => {
          const to = (e.after as { status?: string } | null)?.status;
          return (
            <div className="audit-row" key={e.id}>
              <span className="audit-when">{new Date(e.at).toLocaleString(undefined, {
                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}</span>
              <span className="audit-what">
                <b>{nameOf(e.actor_id)}</b>{" "}
                <span>{ACTION_LABEL[e.action] ?? e.action}</span>
                {to ? <b> {to}</b> : null}
              </span>
            </div>
          );
        })}
      </div>
      <p className="hint">Recorded by the database, not the app — this log cannot be edited or deleted.</p>
    </section>
  );
}
