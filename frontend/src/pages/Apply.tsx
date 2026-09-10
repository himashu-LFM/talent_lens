/* Public application form — the only unauthenticated write path a candidate uses.
   Reachable at /apply/:token, where the token is unguessable and can be switched
   off from the Jobs page at any time. */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, FileText, Link2, Send, UploadCloud, X } from "lucide-react";
import { publicApply, publicJob, type ApplyForm, type PublicJob } from "../api";
import { LogoTile } from "../components/Logo";
import { Spinner } from "../components/ui";

const ACCEPT = ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp";
const MAX_MB = 15;

/* Voluntary, self-reported, and never fed to the scoring engine. Used only for
   aggregate adverse-impact reporting with a minimum group size. */
const VOLUNTARY = [
  {
    key: "gender", label: "Gender",
    options: ["woman", "man", "non_binary", "self_describe", "prefer_not_to_say"],
  },
  {
    key: "ethnicity", label: "Ethnicity or background",
    options: ["asian", "black", "hispanic_latino", "middle_eastern", "white", "mixed", "other", "prefer_not_to_say"],
  },
  {
    key: "disability", label: "Do you consider yourself to have a disability?",
    options: ["yes", "no", "prefer_not_to_say"],
  },
] as const;

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function Apply() {
  const { token = "" } = useParams();
  const [job, setJob] = useState<PublicJob | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<ApplyForm>({ name: "", email: "", consent: false });
  const [linkedin, setLinkedin] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [demo, setDemo] = useState<Record<string, string>>({});
  const [showVoluntary, setShowVoluntary] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ statusUrl: string; duplicate: boolean; message: string } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    publicJob(token)
      .then(setJob)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "This link is not valid."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (job) document.title = `Apply — ${job.title}${job.company ? ` · ${job.company}` : ""}`;
  }, [job]);

  const set = <K extends keyof ApplyForm>(k: K, v: ApplyForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { setErr(`That file is larger than ${MAX_MB} MB.`); return; }
    setErr("");
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!file) { setErr("Please attach your resume."); return; }
    if (!form.consent) { setErr("Please tick the consent box so we can process your application."); return; }
    setBusy(true);
    try {
      const links: Record<string, string> = {};
      if (linkedin.trim()) links.linkedin = linkedin.trim();
      if (portfolio.trim()) links.portfolio = portfolio.trim();
      const answered = Object.fromEntries(Object.entries(demo).filter(([, v]) => v));
      const res = await publicApply(token, {
        ...form,
        links,
        voluntary_demographics: Object.keys(answered).length ? answered : undefined,
      }, file);
      setDone({ statusUrl: res.status_url, duplicate: res.duplicate, message: res.message });
      window.scrollTo(0, 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  if (loading) {
    return <div className="pub"><div className="pub-wrap" style={{ textAlign: "center", paddingTop: 80 }}><Spinner size={26} /></div></div>;
  }

  if (loadErr || !job) {
    return (
      <div className="pub">
        <div className="pub-wrap pub-done">
          <div className="tick" style={{ background: "rgba(239,68,68,.14)", color: "var(--danger)" }}>
            <AlertCircle size={30} />
          </div>
          <h1 className="pub-title">This link isn't available</h1>
          <p className="muted">{loadErr || "The role may have closed, or the link is incomplete."}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="pub">
        <header className="pub-head">
          <div className="pub-head-in">
            <LogoTile size={32} radius={10} glyph={20} />
            <b>{job.company || "Hiring team"}</b>
          </div>
        </header>
        <div className="pub-wrap pub-done">
          <div className="tick"><CheckCircle2 size={30} /></div>
          <h1 className="pub-title">{done.duplicate ? "You've already applied" : "Application received"}</h1>
          <p className="muted" style={{ maxWidth: 460, margin: "0 auto 24px", lineHeight: 1.7 }}>
            {done.duplicate
              ? `We already have your application for ${job.title}. Nothing more to do — track it below.`
              : `Thanks for applying for ${job.title}. We've emailed you a link to track your progress, and it's below too.`}
          </p>
          {done.statusUrl && (
            <a className="btn btn-primary" href={done.statusUrl}>
              <Link2 size={15} /> Track your application
            </a>
          )}
          <p className="pub-note" style={{ maxWidth: 460, margin: "24px auto 0" }}>
            Bookmark that link. It's the only way back to your status, and it works without a password.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pub">
      <header className="pub-head">
        <div className="pub-head-in">
          <LogoTile size={32} radius={10} glyph={20} />
          <b>{job.company || "Hiring team"}</b>
          {job.contact_email && (
            <span className="right">Questions? <a href={`mailto:${job.contact_email}`}>{job.contact_email}</a></span>
          )}
        </div>
      </header>

      <div className="pub-wrap">
        <h1 className="pub-title">{job.title}</h1>
        <div className="pub-sub">
          {job.location && <span>{job.location}</span>}
          {job.employment_type && <span>{job.employment_type}</span>}
          {job.company && <span>{job.company}</span>}
        </div>

        <div className="pub-jd">{job.description}</div>
        <p className="pub-note">
          Your application is screened against this description. The scoring runs on the
          hiring team's own machine and assists a human reviewer — it does not decide.
        </p>

        <form onSubmit={submit}>
          <div className="pub-section">About you</div>
          <div className="pub-grid">
            <div className="field">
              <label className="field-label" htmlFor="ap-name">Full name *</label>
              <input id="ap-name" className="input" required value={form.name}
                onChange={(e) => set("name", e.target.value)} autoComplete="name" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-email">Email *</label>
              <input id="ap-email" className="input" type="email" required value={form.email}
                onChange={(e) => set("email", e.target.value)} autoComplete="email" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-phone">Phone</label>
              <input id="ap-phone" className="input" value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-loc">Where are you based?</label>
              <input id="ap-loc" className="input" value={form.location ?? ""}
                onChange={(e) => set("location", e.target.value)} placeholder="City, country" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-co">Current company</label>
              <input id="ap-co" className="input" value={form.current_company ?? ""}
                onChange={(e) => set("current_company", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-title">Current title</label>
              <input id="ap-title" className="input" value={form.current_title ?? ""}
                onChange={(e) => set("current_title", e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-notice">Notice period</label>
              <input id="ap-notice" className="input" value={form.notice_period ?? ""}
                onChange={(e) => set("notice_period", e.target.value)} placeholder="e.g. 30 days, immediate" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-salary">Expected salary</label>
              <input id="ap-salary" className="input" value={form.expected_salary ?? ""}
                onChange={(e) => set("expected_salary", e.target.value)} placeholder="Optional" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-li">LinkedIn</label>
              <input id="ap-li" className="input" value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)} placeholder="linkedin.com/in/…" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ap-pf">Portfolio or GitHub</label>
              <input id="ap-pf" className="input" value={portfolio}
                onChange={(e) => setPortfolio(e.target.value)} />
            </div>
          </div>

          <div className="pub-section">Your resume *</div>
          {file ? (
            <div className="file-chip" style={{ fontSize: 13, padding: "10px 12px" }}>
              <FileText size={15} />
              <span className="file-name">{file.name}</span>
              <span className="file-size">{Math.max(1, Math.round(file.size / 1024))} KB</span>
              <button type="button" className="file-remove" onClick={() => setFile(null)} aria-label="Remove file">
                <X size={13} />
              </button>
            </div>
          ) : (
            <label className={`dropzone ${drag ? "dropzone--active" : ""}`} style={{ display: "block" }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files?.[0]); }}>
              <div className="dz-icon"><UploadCloud size={24} /></div>
              <div className="dz-text">Drop your resume here or <span className="link">browse</span></div>
              <div className="dz-hint">PDF, DOCX, TXT — or a clear photo of it. Up to {MAX_MB} MB.</div>
              <input type="file" accept={ACCEPT} hidden
                onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
          )}
          <p className="pub-note">
            A scan or phone photo is fine — we read those with on-device text recognition.
          </p>

          <div className="pub-section">Anything else?</div>
          <div className="field">
            <label className="field-label" htmlFor="ap-note">Cover note</label>
            <textarea id="ap-note" className="input textarea" rows={5} value={form.cover_note ?? ""}
              onChange={(e) => set("cover_note", e.target.value)}
              placeholder="Why this role, and anything your resume doesn't say." />
          </div>

          <div className="pub-section">
            <button type="button" className="link-btn" onClick={() => setShowVoluntary((v) => !v)}>
              {showVoluntary ? "Hide" : "Show"} optional diversity questions
            </button>
          </div>
          {showVoluntary && (
            <>
              <p className="pub-note" style={{ marginTop: 0, marginBottom: 14 }}>
                Entirely optional and never used to screen you. Answers are reported only as
                aggregate totals, and only once enough people have answered that no individual
                can be identified. You can skip every question.
              </p>
              <div className="pub-grid">
                {VOLUNTARY.map((q) => (
                  <div className="field" key={q.key}>
                    <label className="field-label" htmlFor={`vd-${q.key}`}>{q.label}</label>
                    <select id={`vd-${q.key}`} className="input" value={demo[q.key] ?? ""}
                      onChange={(e) => setDemo((d) => ({ ...d, [q.key]: e.target.value }))}>
                      <option value="">Skip this question</option>
                      {q.options.map((o) => <option key={o} value={o}>{pretty(o)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="pub-section">Consent</div>
          <label className="pub-consent">
            <input type="checkbox" className="check" checked={form.consent}
              onChange={(e) => set("consent", e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              I agree that {job.company || "this employer"} may store and process my resume and the
              details above to consider me for this role. I can ask for my data to be deleted at any
              time from my status page, and it will be erased.
            </span>
          </label>

          {err && (
            <div className="notice warn" style={{ marginTop: 16 }}>
              <b>Couldn't submit.</b> {err}
            </div>
          )}

          <button className="btn btn-primary lg full" style={{ marginTop: 20 }} disabled={busy}>
            {busy ? <Spinner /> : <Send size={16} />} {busy ? "Sending…" : "Submit application"}
          </button>
          <p className="pub-note" style={{ textAlign: "center" }}>
            You'll get an email with a link to track your progress.
          </p>
        </form>
      </div>
    </div>
  );
}
