/** ListenFirst aperture mark.
 *
 *  Three charcoal shutter blades rotated 120° apart, separated by spiral slits, with
 *  the triangular aperture opening filled in brand gold.
 *
 *  Geometry (viewBox 0 0 100 100, centre 50,50): blade 0 runs from the inner vertex at
 *  θ=90° out to the rim at θ=50°, along the rim to θ=160°, then back to the inner
 *  vertex at θ=200°. The 10° shortfall against the next blade's 210° edge is the slit.
 */
const BLADE = "M50 35 L79.568 14.762 A46 46 0 0 0 6.774 34.267 L35.905 55.13 Z";

export default function Logo({ size = 34, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={`logo-mark ${spin ? "logo-spin" : ""}`} width={size} height={size} aria-hidden="true">
      <path d="M50 34 L63.856 58 L36.144 58 Z" fill="#F5C518" />
      <g className="blades" fill="var(--logo-ink, #231f20)">
        <path d={BLADE} />
        <path d={BLADE} transform="rotate(120 50 50)" />
        <path d={BLADE} transform="rotate(240 50 50)" />
      </g>
    </svg>
  );
}

/** The mark as a knockout on the amber gradient tile used across the app chrome:
 *  blades in the canvas colour, the aperture triangle showing the tile through. */
export function LogoTile({ size = 46, radius, glyph }: { size?: number; radius?: number; glyph?: number }) {
  const g = glyph ?? Math.round(size * 0.58);
  return (
    <span className="logo-tile" style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.33), background: "linear-gradient(135deg, #fbbf24, #d97706)", boxShadow: "0 8px 24px rgba(245,158,11,.28)", display: "inline-grid", placeItems: "center", flex: "none" }} aria-hidden>
      <svg viewBox="0 0 100 100" width={g} height={g}>
        <g fill="#020617">
          <path d={BLADE} />
          <path d={BLADE} transform="rotate(120 50 50)" />
          <path d={BLADE} transform="rotate(240 50 50)" />
        </g>
      </svg>
    </span>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-text" style={{ display: "flex", flexDirection: "column", lineHeight: 1.05, textAlign: "left" }}>
      <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-.02em" }}>TalentLens</span>
      {!compact && <span style={{ fontSize: 10.5, color: "var(--muted)", letterSpacing: ".04em" }}>by ListenFirst</span>}
    </div>
  );
}
