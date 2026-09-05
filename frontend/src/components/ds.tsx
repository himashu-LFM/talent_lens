/* Design-system primitives mirroring the handoff's component set:
   StatCard · Badge · Avatar · ProgressBar · Eyebrow · SegTabs · Kbd */
import type { ReactNode } from "react";
import { Num } from "./ui";

export type Tone = "blue" | "amber" | "emerald" | "purple";

export function StatCard({ tone, title, value, sub, icon, decimals = 0 }: {
  tone: Tone; title: string; value: number; sub?: string; icon?: ReactNode; decimals?: number;
}) {
  return (
    <div className={`statcard ${tone}`}>
      <div className="statcard-inner">
        <div style={{ minWidth: 0 }}>
          <p className="statcard-title">{title}</p>
          <p className="statcard-value"><Num value={value} decimals={decimals} /></p>
          {sub && <p className="statcard-sub">{sub}</p>}
        </div>
        {icon && <div className="statcard-ico">{icon}</div>}
      </div>
    </div>
  );
}

export type BadgeVariant = "success" | "warning" | "info" | "danger" | "neutral" | "purple";
export function Badge({ variant = "neutral", children, icon }: { variant?: BadgeVariant; children: ReactNode; icon?: ReactNode }) {
  return <span className={`badge badge-${variant}`}>{icon}{children}</span>;
}

export type AvatarTone = "emerald" | "amber" | "blue" | "purple" | "slate";
export function Avatar({ initials, tone = "emerald", size = 36 }: { initials: string; tone?: AvatarTone; size?: number }) {
  return (
    <span className={`avatar ${tone}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4), borderRadius: Math.round(size * 0.3) }} aria-hidden>
      {initials}
    </span>
  );
}

export function initialsOf(s: string) {
  const parts = (s || "").split("@")[0].split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function ProgressBar({ value, tone = "amber", height = 6, delay = 0 }: { value: number; tone?: "amber" | "mixed" | "emerald" | "flat"; height?: number; delay?: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`pbar ${tone}`} style={{ height }}>
      <span style={{ width: `${pct}%`, animationDelay: `${delay}s` }} />
    </div>
  );
}

export function Eyebrow({ children, amber, tight }: { children: ReactNode; amber?: boolean; tight?: boolean }) {
  return <div className={`eyebrow ${amber ? "amber" : ""} ${tight ? "tight" : ""}`}>{children}</div>;
}

export function SegTabs<T extends string>({ value, onChange, items, small, surface }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; small?: boolean; surface?: boolean;
}) {
  return (
    <div className={`seg ${small ? "sm" : ""} ${surface ? "on-surface" : ""}`} role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} className={`seg-btn ${value === it.value ? "on" : ""}`} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

export const scoreClass = (s: number) => (s >= 80 ? "high" : s >= 60 ? "mid" : "low");
export const statusVariant = (s: string): BadgeVariant =>
  s === "shortlisted" ? "warning" : s === "interview" ? "info" : s === "rejected" ? "danger" : s === "hired" ? "success" : "neutral";
