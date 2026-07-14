export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="logo-mark"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="46" fill="#111" stroke="#2a2a2e" strokeWidth="2" />
      <g fill="#1c1c20">
        <path d="M50 8 A42 42 0 0 1 86 29 L50 50 Z" />
        <path d="M86 29 A42 42 0 0 1 86 71 L50 50 Z" />
        <path d="M86 71 A42 42 0 0 1 50 92 L50 50 Z" />
        <path d="M50 92 A42 42 0 0 1 14 71 L50 50 Z" />
        <path d="M14 71 A42 42 0 0 1 14 29 L50 50 Z" />
      </g>
      <path d="M14 29 A42 42 0 0 1 50 8 L50 50 Z" fill="#F5C518" />
    </svg>
  );
}
