import { useEffect, useRef, useState } from "react";

interface Props {
  value: number; // 0-100
  size?: number;
  stroke?: number;
  delay?: number;
}

function colorFor(v: number) {
  if (v >= 70) return { a: "#F5C518", b: "#FFE066" };
  if (v >= 40) return { a: "#C79A2E", b: "#E0B84A" };
  return { a: "#6B6B70", b: "#9A9AA0" };
}

export default function ScoreRing({
  value,
  size = 92,
  stroke = 8,
  delay = 0,
}: Props) {
  const [shown, setShown] = useState(0);
  const raf = useRef<number>();
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const { a, b } = colorFor(value);
  const id = `grad-${Math.round(value)}-${size}`;

  useEffect(() => {
    const start = performance.now();
    const dur = 1100;
    const from = 0;
    const to = value;
    function tick(now: number) {
      const t = Math.min((now - start - delay) / dur, 1);
      if (t < 0) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (to - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, delay]);

  const offset = circ - (shown / 100) * circ;

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={a} />
            <stop offset="100%" stopColor={b} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ filter: `drop-shadow(0 0 6px ${a}66)` }}
        />
      </svg>
      <div className="score-ring-label">
        <span className="score-ring-num">{Math.round(shown)}</span>
      </div>
    </div>
  );
}
