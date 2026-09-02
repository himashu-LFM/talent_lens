import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3, History as HistoryIcon, LayoutDashboard, LogOut, Moon, ScanLine, Search, Settings, Sun, User, Users,
} from "lucide-react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  group: "Navigate" | "Actions" | "Jobs";
  run: () => void;
  keywords?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSignOut: () => void;
  extra?: Command[];
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export default function CommandPalette({ open, onClose, theme, onToggleTheme, onSignOut, extra = [] }: Props) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(() => [
    { id: "dash", label: "Dashboard", hint: "Screen resumes", icon: <LayoutDashboard size={16} />, group: "Navigate", run: () => nav("/"), keywords: "home screen" },
    { id: "hist", label: "History", hint: "Past runs", icon: <HistoryIcon size={16} />, group: "Navigate", run: () => nav("/history") },
    { id: "pool", label: "Talent pool", hint: "Every candidate", icon: <Users size={16} />, group: "Navigate", run: () => nav("/talent"), keywords: "candidates search" },
    { id: "ana", label: "Analytics", hint: "Funnel & trends", icon: <BarChart3 size={16} />, group: "Navigate", run: () => nav("/analytics"), keywords: "charts" },
    { id: "set", label: "Settings", hint: "Gmail, taxonomy, watches", icon: <Settings size={16} />, group: "Navigate", run: () => nav("/settings") },
    { id: "prof", label: "Profile", icon: <User size={16} />, group: "Navigate", run: () => nav("/profile"), keywords: "account" },
    { id: "screen", label: "Start a new screening", hint: "Go to dashboard", icon: <ScanLine size={16} />, group: "Actions", run: () => { nav("/"); setTimeout(() => document.getElementById("job-desc")?.focus(), 250); } },
    { id: "theme", label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: theme === "dark" ? <Sun size={16} /> : <Moon size={16} />, group: "Actions", run: onToggleTheme, keywords: "appearance mode" },
    { id: "out", label: "Sign out", icon: <LogOut size={16} />, group: "Actions", run: onSignOut, keywords: "logout" },
    ...extra,
  ], [nav, theme, onToggleTheme, onSignOut, extra]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(t));
  }, [commands, q]);

  useEffect(() => { if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => setActive(0), [q]);

  function runAt(i: number) {
    const c = filtered[i];
    if (!c) return;
    onClose();
    setTimeout(c.run, 0);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); runAt(active); }
    else if (e.key === "Escape") onClose();
  }

  const groups = ["Navigate", "Actions", "Jobs"] as const;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="cmd-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="cmd" role="dialog" aria-modal="true" aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cmd-input">
              <Search size={17} />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Type a command or search…" aria-label="Search commands" />
              <kbd>esc</kbd>
            </div>
            <div className="cmd-list" role="listbox">
              {filtered.length === 0 && <div className="cmd-empty">No matches.</div>}
              {groups.map((g) => {
                const items = filtered.filter((c) => c.group === g);
                if (!items.length) return null;
                return (
                  <div key={g}>
                    <div className="cmd-group">{g}</div>
                    {items.map((c) => {
                      const idx = filtered.indexOf(c);
                      return (
                        <button key={c.id} role="option" aria-selected={idx === active}
                          className={`cmd-item ${idx === active ? "active" : ""}`}
                          onMouseEnter={() => setActive(idx)} onClick={() => runAt(idx)}>
                          <span className="cmd-ico">{c.icon}</span>
                          <span className="cmd-label">{c.label}</span>
                          {c.hint && <span className="cmd-hint">{c.hint}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="cmd-foot"><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> run · <kbd>ctrl</kbd>+<kbd>k</kbd> toggle</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
