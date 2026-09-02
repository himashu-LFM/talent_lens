interface Props {
  title: string;
  description: string;
  topN: number;
  onTitle: (v: string) => void;
  onDescription: (v: string) => void;
  onTopN: (v: number) => void;
  /** Render fields only (parent supplies the panel + heading). */
  bare?: boolean;
}

export default function JobForm({ title, description, topN, onTitle, onDescription, onTopN, bare }: Props) {
  const body = (
    <>
      <div className="field">
        <label className="field-label" htmlFor="job-title">Job title</label>
        <input id="job-title" className="input" placeholder="e.g. Senior Backend Python Engineer" value={title} onChange={(e) => onTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="job-desc">Job description</label>
        <textarea id="job-desc" className="input textarea" rows={7}
          placeholder="Paste the full job description. Use 'must have' for critical skills, 'a plus' for optional ones, and 'X or Y' for alternatives."
          value={description} onChange={(e) => onDescription(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="top-n">Shortlist size</label>
        <div className="topn-row">
          <input id="top-n" className="slider" type="range" min={1} max={50} value={Math.min(topN, 50)} onChange={(e) => onTopN(Number(e.target.value))} />
          <input className="input topn-num" type="number" min={1} max={500} value={topN} onChange={(e) => onTopN(Math.max(1, Number(e.target.value) || 1))} />
          <span className="topn-suffix">candidates</span>
        </div>
      </div>
    </>
  );
  if (bare) return body;
  return (
    <div className="panel">
      <div className="panel-head"><h2>Role details</h2></div>
      {body}
    </div>
  );
}
