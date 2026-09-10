/* Fairness report for a run.

   The headline claim is the outcome of a controlled experiment, not a
   correlation: every resume was re-scored under several substituted identities
   with everything else held constant. Zero spread means the ranking provably
   does not read the candidate's name. */
import { AlertTriangle, EyeOff, Scale, ShieldCheck, Sparkles } from "lucide-react";
import type { BiasReport } from "../api";

export default function BiasPanel({ report }: { report: BiasReport }) {
  const a = report.anonymisation;
  const pii = report.resume_pii;
  const jd = report.jd_language;
  const ai = report.adverse_impact;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* --- identity substitution --- */}
      <section className="card">
        <div className="card-head"><h2><Scale size={17} /> Does the score read the name?</h2></div>
        {!a.ran ? (
          <p className="muted small">Not run{a.reason ? ` — ${a.reason}` : ""}.</p>
        ) : (
          <>
            <div className={`bias-verdict ${a.clean ? "clean" : "dirty"}`}>
              {a.clean ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
              <div>
                <p>{a.verdict}</p>
                {a.recommendation && <p className="rec">{a.recommendation}</p>}
              </div>
            </div>

            <div className="spread-grid" style={{ marginTop: 16 }}>
              <div className="fact"><b>{a.max_spread?.toFixed(2) ?? "—"}</b><span>max spread</span></div>
              <div className="fact"><b>{a.mean_spread?.toFixed(2) ?? "—"}</b><span>mean spread</span></div>
              <div className="fact"><b>{a.rank_swaps ?? 0}</b><span>rank changes</span></div>
              <div className="fact"><b>{a.candidates ?? 0}</b><span>candidates</span></div>
              <div className="fact"><b>{a.personas?.length ?? 0}</b><span>identities tried</span></div>
            </div>

            {a.component_spread && (
              <>
                <span className="sub-h" style={{ marginTop: 18 }}>Movement by scoring signal</span>
                <div className="hbars">
                  {Object.entries(a.component_spread).map(([k, v]) => (
                    <div className="hbar" key={k}>
                      <span className="lab">{k}</span>
                      <span className="track">
                        <span style={{
                          width: `${Math.min(100, (v / Math.max(1, a.max_spread || 1)) * 100)}%`,
                          background: v > 0 ? "var(--amber-400)" : "var(--emerald-400)",
                        }} />
                      </span>
                      <span className="v">{v.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <p className="hint">
                  Skills, relevance and experience are token matching, so they should read exactly 0.
                  Anything above 0 in the semantic row means the embedding is picking up identity.
                </p>
              </>
            )}

            {(a.affected?.length ?? 0) > 0 && (
              <>
                <span className="sub-h" style={{ marginTop: 18 }}>Candidates whose score moved</span>
                <div className="table-wrap">
                  <table className="data-tbl">
                    <thead>
                      <tr>
                        <th>Candidate</th><th style={{ textAlign: "right" }}>Spread</th>
                        {a.personas?.map((p) => <th key={p} style={{ textAlign: "right" }}>{p}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {a.affected!.map((row) => (
                        <tr key={row.filename}>
                          <td>{row.name}</td>
                          <td className="tabular" style={{ textAlign: "right", color: "var(--accent-text)" }}>
                            {row.spread.toFixed(2)}
                          </td>
                          {a.personas?.map((p) => (
                            <td key={p} className="tabular" style={{ textAlign: "right" }}>
                              {row.by_persona[p]?.toFixed(1) ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {a.method && <p className="hint">Method: {a.method}.</p>}
          </>
        )}
      </section>

      {/* --- identity fields inside the documents --- */}
      <section className="card">
        <div className="card-head"><h2><EyeOff size={17} /> Identity fields in the resumes</h2></div>
        {pii.categories.length === 0 ? (
          <p className="muted small">
            None of the usual personal fields (date of birth, marital status, gender, photograph)
            appear in these documents.
          </p>
        ) : (
          <>
            <div className="hbars">
              {pii.categories.map((c) => (
                <div className="hbar" key={c.category}>
                  <span className="lab">{c.category}</span>
                  <span className="track">
                    <span style={{ width: `${Math.min(100, (c.count / Math.max(1, pii.affected_candidates)) * 100)}%` }} />
                  </span>
                  <span className="v">{c.count}</span>
                </div>
              ))}
            </div>
            <p className="hint">{pii.note}</p>
          </>
        )}
      </section>

      {/* --- job description wording --- */}
      <section className="card">
        <div className="card-head"><h2><Sparkles size={17} /> Job description wording</h2></div>
        {jd.clean ? (
          <p className="muted small">{jd.note}</p>
        ) : (
          <>
            <div className="chips">
              {jd.issues.map((i) => (
                <span key={i.category} className="chip dashed" title={i.category}>
                  {i.category}: {i.terms.join(", ")}
                </span>
              ))}
            </div>
            <p className="hint">{jd.note}</p>
          </>
        )}
      </section>

      {/* --- adverse impact from voluntary data --- */}
      <section className="card">
        <div className="card-head">
          <h2><Scale size={17} /> Adverse impact</h2>
          <span className="count-pill">min group {ai.min_group_size}</span>
        </div>
        {ai.attributes.length === 0 ? (
          <p className="muted small">
            No voluntary demographic responses yet. Turn on the optional question on your
            apply form and this fills in once enough people have answered.
          </p>
        ) : (
          ai.attributes.map((attr) => (
            <div key={attr.attribute} style={{ marginBottom: 18 }}>
              <span className="sub-h" style={{ textTransform: "capitalize" }}>{attr.attribute}</span>
              <div className="table-wrap">
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>Group</th><th style={{ textAlign: "right" }}>Applied</th>
                      <th style={{ textAlign: "right" }}>Advanced</th>
                      <th style={{ textAlign: "right" }}>Rate</th>
                      <th style={{ textAlign: "right" }}>Impact ratio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attr.rows.map((r) => (
                      <tr key={r.group}>
                        <td style={{ textTransform: "capitalize" }}>{r.group.replace(/_/g, " ")}</td>
                        <td className="tabular" style={{ textAlign: "right" }}>{r.total}</td>
                        <td className="tabular" style={{ textAlign: "right" }}>
                          {r.suppressed ? "—" : r.selected}
                        </td>
                        <td className="tabular" style={{ textAlign: "right" }}>
                          {r.suppressed ? "suppressed" : `${Math.round((r.rate ?? 0) * 100)}%`}
                        </td>
                        <td className="tabular" style={{
                          textAlign: "right",
                          color: r.impact_ratio != null && r.impact_ratio < 0.8 ? "var(--danger)" : undefined,
                        }}>
                          {r.impact_ratio != null ? r.impact_ratio.toFixed(2) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">{attr.note}</p>
            </div>
          ))
        )}
        <p className="hint">{ai.basis}.</p>
      </section>

      <p className="muted small">{report.disclaimer}</p>
    </div>
  );
}
