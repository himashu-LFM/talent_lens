import { useMemo } from "react";

/**
 * Lightweight "AI lens" constellation: nodes orbit a central lens while pulses
 * travel along the edges. Pure SVG + CSS animations (transform/opacity/dash only),
 * so it's GPU-friendly and honours prefers-reduced-motion via the stylesheet.
 */
export default function AIViz({ size = 420, dense = false }: { size?: number; dense?: boolean }) {
  const nodes = useMemo(() => {
    const n = dense ? 22 : 14;
    const out: { x: number; y: number; r: number; d: number }[] = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
      const rad = 120 + rnd() * 70;
      out.push({ x: 210 + Math.cos(a) * rad, y: 210 + Math.sin(a) * rad * 0.82, r: 2.2 + rnd() * 2.6, d: rnd() * 4 });
    }
    return out;
  }, [dense]);

  return (
    <svg viewBox="0 0 420 420" width={size} height={size} className="aiviz" aria-hidden="true">
      <defs>
        <radialGradient id="lensGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd84d" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#f5c518" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f5c518" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="edge" x1="0" x2="1">
          <stop offset="0" stopColor="#f5c518" stopOpacity="0" />
          <stop offset="0.5" stopColor="#f5c518" stopOpacity="0.9" />
          <stop offset="1" stopColor="#f5c518" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* orbit rings */}
      <g className="orbits">
        <ellipse cx="210" cy="210" rx="150" ry="123" />
        <ellipse cx="210" cy="210" rx="190" ry="156" />
        <ellipse cx="210" cy="210" rx="110" ry="90" />
      </g>

      {/* edges to the lens */}
      <g className="edges">
        {nodes.map((p, i) => (
          <line key={i} x1={p.x} y1={p.y} x2="210" y2="210" style={{ animationDelay: `${p.d}s` }} />
        ))}
      </g>
      {/* travelling pulses */}
      <g className="pulses">
        {nodes.filter((_, i) => i % 2 === 0).map((p, i) => (
          <line key={i} x1={p.x} y1={p.y} x2="210" y2="210" stroke="url(#edge)" style={{ animationDelay: `${p.d * 1.3}s` }} />
        ))}
      </g>

      {/* nodes */}
      <g className="nodes">
        {nodes.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} style={{ animationDelay: `${p.d}s` }} />
        ))}
      </g>

      {/* central lens */}
      <circle cx="210" cy="210" r="86" fill="url(#lensGlow)" className="lens-glow" />
      <g className="lens">
        <circle cx="210" cy="210" r="34" />
        <path d="M210 176 A34 34 0 0 1 239 193 L210 210 Z" className="blade gold" />
        <path d="M239 193 A34 34 0 0 1 239 227 L210 210 Z" className="blade" />
        <path d="M239 227 A34 34 0 0 1 210 244 L210 210 Z" className="blade" />
        <path d="M210 244 A34 34 0 0 1 181 227 L210 210 Z" className="blade" />
        <path d="M181 227 A34 34 0 0 1 181 193 L210 210 Z" className="blade" />
        <path d="M181 193 A34 34 0 0 1 210 176 L210 210 Z" className="blade" />
        <circle cx="210" cy="210" r="7" className="pupil" />
      </g>
    </svg>
  );
}
