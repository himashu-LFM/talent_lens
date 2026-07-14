import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Candidate, ScreenResponse } from "../api";

interface Props {
  data: ScreenResponse;
  onExport: () => void;
  exporting: boolean;
}

function scoreClass(s: number) {
  if (s >= 70) return "high";
  if (s >= 40) return "mid";
  return "low";
}

function Row({ c }: { c: Candidate }) {
  const [open, setOpen] = useState(false);
  const top3 = c.rank <= 3;
  return (
    <>
      <tr
        className={`row ${top3 ? "row-top" : ""} ${open ? "row-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <td className="c-rank">
          <span className={`rank-badge ${top3 ? "r" + c.rank : ""}`}>{c.rank}</span>
        </td>
        <td>
          <div className="c-name">{c.name}</div>
          <div className="c-sub">
            {c.filename}
            {c.source ? ` · ${c.source}` : ""}
          </div>
        </td>
        <td className="c-mono">{c.email || "—"}</td>
        <td className="c-mono">{c.phone || "—"}</td>
        <td className="c-exp">{c.experience_years}y</td>
        <td className="c-score">
          <div className="score-cell">
            <span className={`score-num ${scoreClass(c.score)}`}>{c.score}</span>
            <div className="score-bar">
              <div
                className={`score-fill ${scoreClass(c.score)}`}
                style={{ width: `${c.score}%` }}
              />
            </div>
          </div>
        </td>
        <td className="c-caret">{open ? "▾" : "▸"}</td>
      </tr>
      <AnimatePresence>
        {open && (
          <tr className="detail">
            <td colSpan={7}>
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{ overflow: "hidden" }}
              >
                <div className="detail-inner">
                  <div className="breakdown">
                    {Object.entries(c.breakdown).map(([k, v]) => (
                      <div key={k} className="bd">
                        <div className="bd-head">
                          <span>{k}</span>
                          <span className="bd-val">
                            {v.score}/{v.max}
                          </span>
                        </div>
                        <div className="bd-track">
                          <motion.div
                            className="bd-fill"
                            initial={{ width: 0 }}
                            animate={{ width: `${(v.score / v.max) * 100}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="skills">
                    <div>
                      <span className="skills-h matched">Matched skills</span>
                      <div className="tags">
                        {c.matched_skills.length ? (
                          c.matched_skills.map((s) => (
                            <span key={s} className="tag matched">{s}</span>
                          ))
                        ) : (
                          <span className="muted">none</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="skills-h missing">Missing skills</span>
                      <div className="tags">
                        {c.missing_skills.length ? (
                          c.missing_skills.map((s) => (
                            <span key={s} className="tag missing">{s}</span>
                          ))
                        ) : (
                          <span className="muted">none</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

export default function Results({ data, onExport, exporting }: Props) {
  const avg =
    data.top.length > 0
      ? Math.round(
          (data.top.reduce((s, c) => s + c.score, 0) / data.top.length) * 10
        ) / 10
      : 0;

  return (
    <motion.section
      className="panel results"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="panel-head">
        <h2>Shortlist</h2>
        <button className="btn btn-ghost" onClick={onExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{data.total_resumes}</div>
          <div className="stat-label">Resumes screened</div>
        </div>
        <div className="stat">
          <div className="stat-num">{data.top.length}</div>
          <div className="stat-label">Shortlisted</div>
        </div>
        <div className="stat">
          <div className="stat-num accent">{avg}</div>
          <div className="stat-label">Avg. score</div>
        </div>
        <div className="stat grow">
          <div className="stat-label">Required skills</div>
          <div className="tags sm">
            {data.job.required_skills.length ? (
              data.job.required_skills.map((s) => (
                <span key={s} className="tag neutral">{s}</span>
              ))
            ) : (
              <span className="muted">none detected</span>
            )}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Candidate</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Exp.</th>
              <th>Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.top.map((c) => (
              <Row key={c.filename + c.rank} c={c} />
            ))}
          </tbody>
        </table>
      </div>

      {data.errors.length > 0 && (
        <div className="errors">
          {data.errors.map((e) => (
            <div key={e.filename} className="err-line">
              {e.filename}: {e.error}
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
}
