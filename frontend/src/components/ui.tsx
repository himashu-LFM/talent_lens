/* Shared UI primitives: skeletons, spinners, count-up numbers, empty states,
   page transitions, screening progress overlay. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, FileSearch, Loader2, ScanSearch, Sparkles, Trophy } from "lucide-react";

/* ------------------------------------------------------------------ */
export function Skeleton({ w, h = 14, r = 6, className = "" }: { w?: string | number; h?: number; r?: number; className?: string }) {
  return <span className={`sk ${className}`} style={{ width: w ?? "100%", height: h, borderRadius: r }} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="panel">
      <Skeleton w="40%" h={18} />
      <div style={{ height: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ marginBottom: 10 }}><Skeleton w={`${90 - i * 15}%`} /></div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sk-rows">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk-row">
          <Skeleton w={26} h={26} r={8} />
          <Skeleton w="28%" />
          <Skeleton w="22%" />
          <Skeleton w="14%" />
          <Skeleton w="18%" h={8} r={4} />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-hidden />;
}

/* ------------------------------------------------------------------ */
export function useCountUp(target: number, duration = 900) {
  const [v, setV] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(from + (target - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);
  return v;
}

export function Num({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const v = useCountUp(value);
  return <>{decimals ? v.toFixed(decimals) : Math.round(v)}</>;
}

/* ------------------------------------------------------------------ */
export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <motion.div className="panel empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && <div className="empty-action">{action}</div>}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
export function PageTransition({ children, k }: { children: ReactNode; k: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={k}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
const STEPS = [
  { icon: FileSearch, label: "Reading files", hint: "Extracting text from PDFs, DOCX and TXT" },
  { icon: ScanSearch, label: "Parsing candidates", hint: "Names, contacts, skills, experience from date ranges" },
  { icon: Sparkles, label: "Scoring", hint: "Semantic fit · must-have gating · relevance · experience" },
  { icon: Trophy, label: "Ranking", hint: "Building your shortlist with evidence" },
];

/** Full-screen progress overlay shown while a screening request is in flight.
 *  Steps advance on a timer (the API is a single call) and the last step holds
 *  until the request resolves. */
export function ScreeningOverlay({ open, label }: { open: boolean; label?: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!open) { setStep(0); return; }
    const t1 = setTimeout(() => setStep(1), 700);
    const t2 = setTimeout(() => setStep(2), 1800);
    const t3 = setTimeout(() => setStep(3), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="overlay-card" initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.98, opacity: 0 }}>
            <div className="overlay-ring"><span /></div>
            <h3>{label || "Screening resumes"}</h3>
            <ul className="steps">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const state = i < step ? "done" : i === step ? "active" : "todo";
                return (
                  <li key={s.label} className={`step ${state}`}>
                    <span className="step-ico">{state === "done" ? <CheckCircle2 size={18} /> : state === "active" ? <Spinner size={18} /> : <Icon size={18} />}</span>
                    <span><b>{s.label}</b><em>{s.hint}</em></span>
                  </li>
                );
              })}
            </ul>
            <div className="progress"><span /></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
