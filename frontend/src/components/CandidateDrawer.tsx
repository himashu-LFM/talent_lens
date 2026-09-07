/* Candidate detail drawer — score ring, status pills, AI brief, breakdown,
   what-would-raise-this-score, evidence, interview questions, flags, notes. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Copy, FileText, Lightbulb, Mail, MessageSquareText, Phone, Sparkles, TrendingUp, X,
} from "lucide-react";
import type { Candidate } from "../api";
import { STATUSES, type Review, type ReviewStatus } from "../lib/db";
import { Badge, scoreClass, statusVariant } from "./ds";
import { useToast } from "./Toast";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New", shortlisted: "Shortlist", interview: "Interview", rejected: "Reject", hired: "Hired",
};
const STATUS_FULL: Record<ReviewStatus, string> = {
  new: "New", shortlisted: "Shortlisted", interview: "Interview", rejected: "Rejected", hired: "Hired",
};
const RING_COLOR = { high: "var(--emerald-400)", mid: "var(--amber-400)", low: "var(--slate-500)" } as const;

interface Props {
  c: Candidate; index: number; total: number; anon: boolean; review?: Review; prior: number;
  canEmail: boolean; canView: boolean;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  onStatus: (s: ReviewStatus) => void; onNotes: (n: string) => void; onEmail: () => void; onView: () => void;
}

export default function CandidateDrawer(p: Props) {
  const { c, anon } = p;
  const toast = useToast();
  const [notes, setNotes] = useState(p.review?.notes ?? "");
  const notesRef = useRef(p.review?.notes ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const [ringOn, setRingOn] = useState(false);
  const status = p.review?.status ?? "new";
  const name = anon ? `Candidate #${c.rank}` : c.name;

  useEffect(() => { setNotes(p.review?.notes ?? ""); notesRef.current = p.review?.notes ?? ""; }, [p.review?.notes, c.rank]);
  useEffect(() => { closeRef.current?.focus(); setRingOn(false); const t = requestAnimationFrame(() => setRingOn(true)); return () => cancelAnimationFrame(t); }, [c.rank]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "Escape") { p.onClose(); return; }
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") p.onPrev();
      else if (e.key === "ArrowRight") p.onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const flags: { text: string }[] = [];
  if ((c.confidence ?? 1) < 0.6) flags.push({ text: `Low resume-structure confidence (${Math.round((c.confidence ?? 0) * 100)}%) — verify manually.` });
  if (c.duplicate_group) flags.push({ text: "Looks like the same person as another candidate in this batch." });
  if (p.prior > 0) flags.push({ text: `Re-applicant — appeared in ${p.prior} previous run${p.prior === 1 ? "" : "s"}.` });

  const evidence = Object.entries(c.evidence ?? {});
  const sc = scoreClass(c.score);
  const CIRC = 264;
  const offset = ringOn ? CIRC - (CIRC * Math.max(0, Math.min(100, c.score))) / 100 : CIRC;

  return createPortal(
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={p.onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${name} details`}>
        <header className="drawer-head">
          <div className="drawer-nav">
            <button className="icon-btn sm" onClick={p.onPrev} disabled={p.index <= 0} aria-label="Previous candidate"><ChevronLeft size={15} /></button>
            <span>Candidate {p.index + 1} of {p.total}</span>
            <button className="icon-btn sm" onClick={p.onNext} disabled={p.index >= p.total - 1} aria-label="Next candidate"><ChevronRight size={15} /></button>
          </div>
          <button ref={closeRef} className="icon-btn sm danger" onClick={p.onClose} aria-label="Close"><X size={15} /></button>
        </header>

        <div className="drawer-body">
          <section className="drawer-id">
            <div className="ring" style={{ width: 100, height: 100 }} role="img" aria-label={`Match score ${c.score} out of 100`}>
              <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-2)" strokeWidth="9" />
                <circle className="fg" cx="50" cy="50" r="42" fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset} stroke={RING_COLOR[sc]} />
              </svg>
              <div className="ring-label"><b>{c.score}</b><span>score</span></div>
            </div>
            <div className="drawer-who">
              <div className="drawer-rank"><span className={`rank sm ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span> Rank</div>
              <h2 title={name}>{name}</h2>
              {!anon ? (
                <div className="drawer-contact">
                  {c.email && <a href={`mailto:${c.email}`} title={c.email}><Mail size={13} /><span>{c.email}</span></a>}
                  <span><Phone size={13} />{c.phone || "—"}</span>
                </div>
              ) : <div className="muted small">Contact details hidden in anonymized review</div>}
              <div className="muted small ellipsis" style={{ marginTop: 6 }} title={c.filename}>{c.filename}{c.source ? ` · ${c.source}` : ""}</div>
            </div>
          </section>

          <section>
            <div className="section-h">Status</div>
            <div className="status-pills" role="radiogroup" aria-label="Status">
              {STATUSES.filter((s) => s !== "new").map((s) => (
                <button key={s} role="radio" aria-checked={status === s} className={`pill-btn ${s} ${status === s ? "on" : ""}`} onClick={() => p.onStatus(status === s ? "new" : s)}>{STATUS_LABEL[s]}</button>
              ))}
              <span style={{ marginLeft: "auto" }}><Badge variant={statusVariant(status)}>{STATUS_FULL[status]}</Badge></span>
            </div>
          </section>

          {c.brief && (
            <section className="insight">
              <h4 className="section-h"><Sparkles size={14} /> AI brief</h4>
              <p className="insight-lead">{c.brief.headline}</p>
              <p className="muted small" style={{ marginBottom: 12 }}>{c.brief.experience}</p>
              <div className="two-col">
                <div><span className="sub-h ok">Matched</span><div className="chips">{c.matched_skills.length ? c.matched_skills.map((s) => <span key={s} className="chip matched" title={c.evidence?.[s] || ""}>{s}</span>) : <span className="muted small">none</span>}</div></div>
                <div><span className="sub-h">Missing</span><div className="chips">{c.missing_skills.length ? c.missing_skills.map((s) => <span key={s} className="chip missing">{s}</span>) : <span className="muted small">none of the must-haves</span>}</div></div>
              </div>
            </section>
          )}

          <section className="insight">
            <h4 className="section-h"><TrendingUp size={14} /> Score breakdown</h4>
            <div className="two-col">
              {Object.entries(c.breakdown).map(([k, v], i) => (
                <div key={k} className="bd">
                  <div className="l"><span>{k}</span><b>{v.score}/{v.max}</b></div>
                  <div className="track"><span style={{ width: `${v.max ? (v.score / v.max) * 100 : 0}%`, animationDelay: `${i * 0.06}s` }} /></div>
                </div>
              ))}
            </div>
          </section>

          {(c.improvements?.length ?? 0) > 0 && (
            <section className="insight">
              <h4 className="section-h"><Lightbulb size={14} /> What would raise this score</h4>
              <ul className="imp-list">
                {c.improvements!.slice(0, 5).map((i) => (
                  <li key={i.requirement}><span className="imp-pts">+{i.points}</span><span>{i.requirement}</span>{i.must_have && <span className="mini-tag warn">must-have</span>}</li>
                ))}
              </ul>
            </section>
          )}

          {(evidence.length > 0 || c.best_match_snippet) && (
            <section className="insight">
              <h4 className="section-h"><FileText size={14} /> Evidence from the resume</h4>
              {c.best_match_snippet && <div className="evi"><div className="k">Best semantic match</div><p>“{c.best_match_snippet}”</p></div>}
              {evidence.slice(0, 6).map(([k, v]) => <div key={k} className="evi"><div className="k">{k}</div><p>“{v}”</p></div>)}
            </section>
          )}

          {(c.interview_questions?.length ?? 0) > 0 && (
            <section className="insight">
              <h4 className="section-h"><MessageSquareText size={14} /> Suggested interview questions
                <button className="link-btn r" onClick={() => { navigator.clipboard?.writeText(c.interview_questions!.map((q, i) => `${i + 1}. ${q}`).join("\n")); toast.success("Questions copied.", 1800); }}><Copy size={13} /> Copy</button>
              </h4>
              <ol className="q-list">{c.interview_questions!.map((q, i) => <li key={i}>{q}</li>)}</ol>
            </section>
          )}

          {flags.length > 0 && (
            <section className="insight warn">
              <h4 className="section-h"><AlertTriangle size={14} /> Flags</h4>
              <ul className="flag-list">{flags.map((f, i) => <li key={i}><AlertTriangle size={14} /><span>{f.text}</span></li>)}</ul>
            </section>
          )}

          <section>
            <div className="section-h">Reviewer notes</div>
            <textarea className="input textarea" rows={3} placeholder="Interview notes, red flags, next steps…" value={notes} style={{ background: "var(--surface-1)" }}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== notesRef.current) { notesRef.current = notes; p.onNotes(notes); } }} />
          </section>
        </div>

        <footer className="drawer-foot">
          {p.canView && <button className="btn btn-ghost sm" onClick={p.onView}><FileText size={14} /> View resume</button>}
          {p.canEmail && <button className="btn btn-ghost sm" onClick={p.onEmail}><Mail size={14} /> Email</button>}
          <span className="hint-r">← → switch · esc close</span>
        </footer>
      </aside>
    </div>,
    document.body
  );
}
