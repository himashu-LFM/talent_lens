import { useEffect, useRef, useState } from "react";

interface Props {
  value: number; // 0-100
  size?: number;
  stroke?: number;
  delay?: number;
}

function colorFor(v: number) {
  if (v >= 70) return { a: "var(--gold)", b: "var(--gold-2)" };
  if (v >= 40) return { a: "var(--amber)", b: "var(--gold)" };
  return { a: "var(--faint)", b: "var(--muted)" };
}

/** Animated circular match-score visualization. */
export default function ScoreRing({ value, size = 92, stroke = 8, delay = 0 }: Props) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const { a, b } = colorFor(value);
  const id = `ring-${Math.round(value * 10)}-${size}`;

  useEffect(() => {
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const t = Math.min((now - start - delay) / dur, 1);
      if (t < 0) { raf.current = requestAnimationFrame(tick); return; }
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, delay]);

  return (
    <div className="score-ring" style={{ width: size, height: size }} role="img" aria-label={`Match score ${Math.round(value)} out of 100`}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={a} />
            <stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ - (shown / 100) * circ} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="score-ring-label"><span className="score-ring-num">{Math.round(shown)}</span><span className="score-ring-sub">match</span></div>
    </div>
  );
}
