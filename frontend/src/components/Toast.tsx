import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

type ToastKind = "info" | "success" | "error" | "loading";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string, ttl?: number) => number;
  update: (id: number, kind: ToastKind, message: string, ttl?: number) => void;
  dismiss: (id: number) => void;
  info: (m: string, ttl?: number) => number;
  success: (m: string, ttl?: number) => number;
  error: (m: string, ttl?: number) => number;
  loading: (m: string) => number;
}

const ToastCtx = createContext<ToastApi | null>(null);

const ICON: Record<ToastKind, string> = {
  info: "ℹ",
  success: "✓",
  error: "⚠",
  loading: "⏳",
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const schedule = useCallback(
    (id: number, ttl: number) => {
      if (timers.current[id]) clearTimeout(timers.current[id]);
      if (ttl > 0) timers.current[id] = setTimeout(() => dismiss(id), ttl);
    },
    [dismiss]
  );

  const push = useCallback(
    (kind: ToastKind, message: string, ttl = 4000) => {
      const id = ++idRef.current;
      setToasts((t) => [...t, { id, kind, message }]);
      schedule(id, kind === "loading" ? 0 : ttl);
      return id;
    },
    [schedule]
  );

  const update = useCallback(
    (id: number, kind: ToastKind, message: string, ttl = 4000) => {
      setToasts((t) =>
        t.map((x) => (x.id === id ? { ...x, kind, message } : x))
      );
      schedule(id, kind === "loading" ? 0 : ttl);
    },
    [schedule]
  );

  const api: ToastApi = {
    push,
    update,
    dismiss,
    info: (m, ttl) => push("info", m, ttl),
    success: (m, ttl) => push("success", m, ttl),
    error: (m, ttl) => push("error", m, ttl ?? 6000),
    loading: (m) => push("loading", m),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`toast toast--${t.kind}`}
              initial={{ opacity: 0, x: 40, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={() => dismiss(t.id)}
            >
              <span className={`toast-icon ${t.kind === "loading" ? "spin" : ""}`}>
                {ICON[t.kind]}
              </span>
              <span className="toast-msg">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
