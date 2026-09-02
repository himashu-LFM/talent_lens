/** ListenFirst-style aperture mark. `spin` animates the blades slowly. */
export default function Logo({ size = 34, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={`logo-mark ${spin ? "logo-spin" : ""}`} width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="lf-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd84d" />
          <stop offset="1" stopColor="#e6b400" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="47" fill="#0d0d10" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
      <g className="blades" fill="#1e1f24">
        <path d="M50 6 A44 44 0 0 1 88 28 L50 50 Z" />
        <path d="M88 28 A44 44 0 0 1 88 72 L50 50 Z" />
        <path d="M88 72 A44 44 0 0 1 50 94 L50 50 Z" />
        <path d="M50 94 A44 44 0 0 1 12 72 L50 50 Z" />
        <path d="M12 72 A44 44 0 0 1 12 28 L50 50 Z" />
        <path d="M12 28 A44 44 0 0 1 50 6 L50 50 Z" fill="url(#lf-gold)" />
      </g>
      <circle cx="50" cy="50" r="9" fill="#0d0d10" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-text">
      <span className="brand-name">TalentLens</span>
      {!compact && <span className="brand-by">by ListenFirst</span>}
    </div>
  );
}
