/** ListenFirst aperture mark.
 *
 *  Three charcoal shutter blades rotated 120° apart, separated by spiral slits, with
 *  the triangular aperture opening filled in brand gold. No backing disc — the mark is
 *  transparent so it sits on light and dark surfaces alike.
 *
 *  Geometry (viewBox 0 0 100 100, centre 50,50): blade 0 runs from the inner vertex at
 *  θ=90° out to the rim at θ=50°, along the rim to θ=160°, then back to the inner
 *  vertex at θ=200°. The 10° shortfall against the next blade's 210° edge is the slit.
 *  `spin` animates the blades slowly.
 */
const BLADE =
  "M50 35 L79.568 14.762 A46 46 0 0 0 6.774 34.267 L35.905 55.13 Z";

export default function Logo({ size = 34, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`logo-mark ${spin ? "logo-spin" : ""}`}
      width={size}
      height={size}
      aria-hidden="true"
    >
      {/* aperture opening — drawn first so the blades crop it to a crisp triangle */}
      <path d="M50 34 L63.856 58 L36.144 58 Z" fill="#F5C518" />
      <g className="blades" fill="var(--logo-ink, #231f20)">
        <path d={BLADE} />
        <path d={BLADE} transform="rotate(120 50 50)" />
        <path d={BLADE} transform="rotate(240 50 50)" />
      </g>
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
