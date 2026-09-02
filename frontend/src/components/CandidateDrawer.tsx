import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Copy, FileText, Lightbulb, Mail, MessageSquareText, Phone, Sparkles, TrendingUp, X,
} from "lucide-react";
import type { Candidate } from "../api";
import { STATUSES, type Review, type ReviewStatus } from "../lib/db";
import ScoreRing from "./ScoreRing";
import { useToast } from "./Toast";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "New", shortlisted: "Shortlisted", interview: "Interview", rejected: "Rejected", hired: "Hired",
};

interface Props {
  c: Candidate;
  index: number;
  total: number;
  anon: boolean;
  review?: Review;
  prior: number;
  canEmail: boolean;
  canView: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onStatus: (s: ReviewStatus) => void;
  onNotes: (n: string) => void;
  onEmail: () => void;
  onView: () => void;
}

export default function CandidateDrawer(p: Props) {
  const { c, anon } = p;
  const toast = useToast();
  const [notes, setNotes] = useState(p.review?.notes ?? "");
  const notesRef = useRef(p.review?.notes ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const status = p.review?.status ?? "new";
  const name = anon ? `Candidate #${c.rank}` : c.name;

  useEffect(() => { setNotes(p.review?.notes ?? ""); notesRef.current = p.review?.notes ?? ""; }, [p.review?.notes, c.rank]);
  useEffect(() => { closeRef.current?.focus(); }, [c.rank]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") { if (e.key === "Escape") p.onClose(); return; }
      if (e.key === "Escape") p.onClose();
      else if (e.key === "ArrowLeft") p.onPrev();
      else if (e.key === "ArrowRight") p.onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const flags: { icon: JSX.Element; text: string }[] = [];
  if ((c.confidence ?? 1) < 0.6) flags.push({ icon: <AlertTriangle size={14} />, text: `Low resume-structure confidence (${Math.round((c.confidence ?? 0) * 100)}%) — verify manually.` });
  if (c.duplicate_group) flags.push({ icon: <AlertTriangle size={14} />, text: "Looks like the same person as another candidate in this batch." });
  if (p.prior > 0) flags.push({ icon: <TrendingUp size={14} />, text: `Re-applicant — appeared in ${p.prior} previous run${p.prior === 1 ? "" : "s"}.` });

  const evidence = Object.entries(c.evidence ?? {});

  return createPortal(
    <>
      <div className="drawer-scrim" onClick={p.onClose} />
      <motion.aside
        className="drawer" role="dialog" aria-modal="true" aria-label={`${name} details`}
        initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
      >
        <header className="drawer-head">
          <div className="drawer-nav">
            <button className="icon-btn" onClick={p.onPrev} disabled={p.index <= 0} aria-label="Previous candidate"><ChevronLeft size={16} /></button>
            <span className="muted small">{p.index + 1} / {p.total}</span>
            <button className="icon-btn" onClick={p.onNext} disabled={p.index >= p.total - 1} aria-label="Next candidate"><ChevronRight size={16} /></button>
          </div>
          <button ref={closeRef} className="icon-btn" onClick={p.onClose} aria-label="Close"><X size={16} /></button>
        </header>

        <div className="drawer-body">
          <section className="drawer-id">
            <ScoreRing value={c.score} size={96} stroke={9} />
            <div className="drawer-who">
              <div className="drawer-rank"><span className={`rank-badge ${c.rank <= 3 ? "r" + c.rank : ""}`}>{c.rank}</span> Rank</div>
              <h2 title={name}>{name}</h2>
              {!anon && (
                <div className="drawer-contact">
                  {c.email && <a href={`mailto:${c.email}`} title={c.email}><Mail size={13} /> <span>{c.email}</span></a>}
                  {c.phone && <span><Phone size={13} /> {c.phone}</span>}
                </div>
              )}
              <div className="muted small ellipsis" title={c.filename}>{c.filename}{c.source ? ` · ${c.source}` : ""}</div>
            </div>
          </section>

          <section className="drawer-status">
            <label className="field-label">Status</label>
            <div className="status-pills" role="radiogroup" aria-label="Status">
              {STATUSES.map((s) => (
                <button key={s} role="radio" aria-checked={status === s} className={`spill st-${s} ${status === s ? "on" : ""}`} onClick={() => p.onStatus(s)}>{STATUS_LABEL[s]}</button>
              ))}
            </div>
          </section>

          {c.brief && (
            <section className="insight">
              <h4><Sparkles size={14} /> AI brief</h4>
              <p className="insight-lead">{c.brief.headline}</p>
              <p className="muted small">{c.brief.experience}</p>
              <div className="brief-cols">
                <div><span className="skills-h matched">Strengths</span><div className="tags">{c.brief.strengths.length ? c.brief.strengths.map((s) => <span key={s} className="tag matched">{s}</span>) : <span className="muted small">—</span>}</div></div>
                <div><span className="skills-h missing">Gaps</span><div className="tags">{c.brief.gaps.length ? c.brief.gaps.map((s) => <span key={s} className="tag missing">{s}</span>) : <span className="muted small">none of the must-haves</span>}</div></div>
              </div>
            </section>
          )}

          <section className="insight">
            <h4><TrendingUp size={14} /> Score breakdown</h4>
            <div className="breakdown">
              {Object.entries(c.breakdown).map(([k, v]) => (
                <div key={k} className="bd">
                  <div className="bd-head"><span>{k}</span><span className="bd-val">{v.score}/{v.max}</span></div>
                  <div className="bd-track"><motion.div className="bd-fill" initial={{ width: 0 }} animate={{ width: `${(v.score / v.max) * 100}%` }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} /></div>
                </div>
              ))}
            </div>
            <div className="skills" style={{ marginTop: 14 }}>
              <div><span className="skills-h matched">Matched</span><div className="tags">{c.matched_skills.length ? c.matched_skills.map((s) => <span key={s} className="tag matched" title={c.evidence?.[s] || ""}>{s}</span>) : <span className="muted small">none</span>}</div></div>
              <div><span className="skills-h missing">Missing</span><div className="tags">{c.missing_skills.length ? c.missing_skills.map((s) => <span key={s} className="tag missing">{s}</span>) : <span className="muted small">none</span>}</div></div>
            </div>
          </section>

          {(c.improvements?.length ?? 0) > 0 && (
            <section className="insight">
              <h4><Lightbulb size={14} /> What would raise this score</h4>
              <ul className="imp-list">
                {c.improvements!.slice(0, 5).map((i) => (
                  <li key={i.requirement}><span className="imp-pts">+{i.points}</span><span>{i.requirement}</span>{i.must_have && <span className="badge-warn">must-have</span>}</li>
                ))}
              </ul>
            </section>
          )}

          {(evidence.length > 0 || c.best_match_snippet) && (
            <section className="insight">
              <h4><FileText size={14} /> Evidence from the resume</h4>
              <ul className="evi-list">
                {c.best_match_snippet && <li><b>Best semantic match</b>“{c.best_match_snippet}”</li>}
                {evidence.slice(0, 6).map(([k, v]) => <li key={k}><b>{k}</b>“{v}”</li>)}
              </ul>
            </section>
          )}

          {(c.interview_questions?.length ?? 0) > 0 && (
            <section className="insight">
              <h4><MessageSquareText size={14} /> Suggested interview questions
                <button className="link-btn" onClick={() => { navigator.clipboard?.writeText(c.interview_questions!.map((q, i) => `${i + 1}. ${q}`).join("\n")); toast.success("Questions copied.", 1800); }}><Copy size={13} /> Copy</button>
              </h4>
              <ol className="q-list">{c.interview_questions!.map((q, i) => <li key={i}>{q}</li>)}</ol>
            </section>
          )}

          {flags.length > 0 && (
            <section className="insight warn">
              <h4><AlertTriangle size={14} /> Flags</h4>
              <ul className="flag-list">{flags.map((f, i) => <li key={i}>{f.icon}<span>{f.text}</span></li>)}</ul>
            </section>
          )}

          <section className="insight">
            <h4>Reviewer notes</h4>
            <textarea className="input textarea" rows={3} placeholder="Interview notes, red flags, next steps…" value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== notesRef.current) { notesRef.current = notes; p.onNotes(notes); } }} />
          </section>
        </div>

        <footer className="drawer-foot">
          {p.canView && <button className="btn btn-ghost sm" onClick={p.onView}><FileText size={14} /> View resume</button>}
          {p.canEmail && <button className="btn btn-ghost sm" onClick={p.onEmail}><Mail size={14} /> Email</button>}
          <span className="kbd-hint small">← → switch · esc close</span>
        </footer>
      </motion.aside>
    </>,
    document.body
  );
}
