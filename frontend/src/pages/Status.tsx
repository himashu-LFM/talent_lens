/* Candidate status page at /status/:token — the "any update?" email killer.
   Deliberately shows the stage, the interview slots and nothing else: no score,
   no internal assessment, no other applicants. */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertCircle, CalendarCheck, CalendarClock, CheckCircle2, Clock, Mail, ShieldOff, Video,
} from "lucide-react";
import { publicBook, publicDeleteRequest, publicStatus, type PublicStatus } from "../api";
import { LogoTile } from "../components/Logo";
import { Spinner } from "../components/ui";

const TRACK: { code: PublicStatus["stage"]; label: string }[] = [
  { code: "received", label: "Received" },
  { code: "in_review", label: "In review" },
  { code: "interview", label: "Interview" },
  { code: "offer", label: "Offer" },
];

function when(iso: string, mins: number) {
  const d = new Date(iso);
  const end = new Date(d.getTime() + mins * 60000);
  return `${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}, ${
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–${
    end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export default function Status() {
  const { token = "" } = useParams();
  const [s, setS] = useState<PublicStatus | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState("");
  const [booked, setBooked] = useState("");
  const [askDelete, setAskDelete] = useState(false);
  const [reason, setReason] = useState("");
  const [deleteDone, setDeleteDone] = useState("");

  const load = () => publicStatus(token)
    .then(setS)
    .catch((e) => setErr(e instanceof Error ? e.message : "This link is not valid."))
    .finally(() => setLoading(false));

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.title = "Your application";
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function book(slotId: string) {
    setBooking(slotId);
    try {
      const res = await publicBook(token, slotId);
      setBooked(res.message);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't book that slot.");
    } finally { setBooking(""); }
  }

  async function requestDeletion() {
    try {
      const res = await publicDeleteRequest(token, reason);
      setDeleteDone(res.message);
      setAskDelete(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't record that request.");
    }
  }

  if (loading) {
    return <div className="pub"><div className="pub-wrap" style={{ textAlign: "center", paddingTop: 80 }}><Spinner size={26} /></div></div>;
  }

  if (!s) {
    return (
      <div className="pub">
        <div className="pub-wrap pub-done">
          <div className="tick" style={{ background: "rgba(239,68,68,.14)", color: "var(--danger)" }}>
            <AlertCircle size={30} />
          </div>
          <h1 className="pub-title">This link isn't available</h1>
          <p className="muted">{err || "Check the link in your confirmation email."}</p>
        </div>
      </div>
    );
  }

  const activeIdx = s.stage === "closed" ? -1 : TRACK.findIndex((t) => t.code === s.stage);

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="pub-head-in">
          <LogoTile size={32} radius={10} glyph={20} />
          <b>{s.company || "Hiring team"}</b>
          {s.contact_email && (
            <span className="right"><Mail size={12} style={{ verticalAlign: -2 }} />{" "}
              <a href={`mailto:${s.contact_email}`}>{s.contact_email}</a></span>
          )}
        </div>
      </header>

      <div className="pub-wrap">
        <h1 className="pub-title">{s.job_title}</h1>
        <div className="pub-sub">
          {s.candidate_name && <span>{s.candidate_name}</span>}
          {s.job_location && <span>{s.job_location}</span>}
          <span>Applied {new Date(s.submitted_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</span>
        </div>

        {s.stage === "closed" ? (
          <div className="bias-verdict" style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.06)" }}>
            <AlertCircle size={20} style={{ color: "var(--danger)" }} />
            <div>
              <p><b>{s.stage_label}</b></p>
              <p className="rec">{s.stage_blurb}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="stage-track" role="img" aria-label={`Stage: ${s.stage_label}`}>
              {TRACK.map((t, i) => (
                <div key={t.code} className={`stage-step ${i < activeIdx ? "done" : i === activeIdx ? "on" : ""}`}>
                  <i />{t.label}
                </div>
              ))}
            </div>
            <div className="bias-verdict clean">
              <CheckCircle2 size={20} />
              <div>
                <p><b>{s.stage_label}</b></p>
                <p className="rec">{s.stage_blurb}</p>
              </div>
            </div>
          </>
        )}

        {booked && (
          <div className="notice" style={{ marginTop: 20, borderColor: "rgba(16,185,129,.35)", background: "rgba(16,185,129,.06)" }}>
            <b>{booked}</b>
          </div>
        )}

        {s.interview && (
          <>
            <div className="pub-section">Your interview</div>
            <div className="card">
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <CalendarCheck size={20} style={{ color: "var(--success)", flex: "none", marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>{when(s.interview.starts_at, s.interview.duration_min)}</b>
                  <div className="job-meta">
                    <span><Clock size={11} style={{ verticalAlign: -1 }} /> {s.interview.duration_min} minutes</span>
                    <span><Video size={11} style={{ verticalAlign: -1 }} /> {s.interview.mode}</span>
                  </div>
                  {(s.interview.meeting_link || s.interview.location) && (
                    <div className="link-box" style={{ marginTop: 10 }}>
                      <code>{s.interview.meeting_link || s.interview.location}</code>
                    </div>
                  )}
                  <p className="pub-note">
                    A calendar invite was emailed to you. Reply to that email if you need to move it.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {s.can_book && !s.interview && (
          <>
            <div className="pub-section">Pick an interview slot</div>
            <div className="slot-grid">
              {s.slots.map((slot) => (
                <button key={slot.id} className="slot" style={{ textAlign: "left", cursor: "pointer" }}
                  onClick={() => book(slot.id)} disabled={!!booking}>
                  <CalendarClock size={16} style={{ color: "var(--accent-text)", flex: "none" }} />
                  <span className="slot-when">
                    <b>{new Date(slot.starts_at).toLocaleString(undefined, {
                      weekday: "short", day: "numeric", month: "short",
                      hour: "2-digit", minute: "2-digit",
                    })}</b>
                    <span>{slot.duration_min} min · {slot.mode}</span>
                  </span>
                  {booking === slot.id && <Spinner size={15} />}
                </button>
              ))}
            </div>
            <p className="pub-note">
              Times are shown in your own timezone. Picking one confirms it immediately and
              sends you a calendar invite.
            </p>
          </>
        )}

        <div className="pub-section">Your data</div>
        {deleteDone ? (
          <div className="notice" style={{ borderColor: "rgba(16,185,129,.35)", background: "rgba(16,185,129,.06)" }}>
            <b>Request recorded.</b> {deleteDone}
          </div>
        ) : askDelete ? (
          <div className="card">
            <p style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 14 }}>
              This erases your name, contact details, resume and cover note from this hiring
              process. The team keeps only an anonymous record that an application was reviewed.
              It cannot be undone, and it withdraws you from consideration.
            </p>
            <div className="field">
              <label className="field-label" htmlFor="del-reason">Reason (optional)</label>
              <input id="del-reason" className="input" value={reason}
                onChange={(e) => setReason(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setAskDelete(false)}>Keep my data</button>
              <button className="btn btn-primary danger" style={{ background: "var(--red-500)", color: "#fff" }}
                onClick={requestDeletion}>
                <ShieldOff size={15} /> Erase my data
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="pub-note" style={{ marginTop: 0 }}>
              You consented to {s.company || "this employer"} processing your application. You can
              withdraw that at any time and your personal data will be erased.
            </p>
            <button className="btn btn-ghost sm" onClick={() => setAskDelete(true)}>
              <ShieldOff size={13} /> Request data deletion
            </button>
          </>
        )}

        {err && <div className="notice warn" style={{ marginTop: 20 }}>{err}</div>}

        <p className="pub-note" style={{ marginTop: 32, textAlign: "center" }}>
          Bookmark this page. It's your private link and needs no password.
        </p>
      </div>
    </div>
  );
}
