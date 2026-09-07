/* Workspace state shared across the app shell: the active screening run (what
   the Shortlist page and the context sidebar show), shortlist filters, the
   sidebar slot element pages portal into, and backend readiness. */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { readiness, type Readiness, type ScreenResponse } from "../api";
import type { ReviewStatus } from "../lib/db";

export type RunSource = "upload" | "gmail" | "auto" | "history";
export interface RunState {
  data: ScreenResponse;
  runId: string | null;
  /** Original File objects (same-session uploads only) — enables the inline viewer. */
  files: File[];
  title: string;
  source: RunSource;
  at: string;
}

export type View = "table" | "heatmap" | "board";
export type SortKey = "score" | "experience" | "name";
export interface Filters {
  query: string;
  minScore: number;
  status: "all" | ReviewStatus;
  anon: boolean;
  view: View;
  sort: SortKey;
}
const DEFAULT_FILTERS: Filters = { query: "", minScore: 0, status: "all", anon: false, view: "table", sort: "score" };

interface Ws {
  run: RunState | null;
  setRun: Dispatch<SetStateAction<RunState | null>>;
  draftTitle: string;
  setDraftTitle: (s: string) => void;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  ready: Readiness | null;
  refreshReady: () => void;
  sidebarEl: HTMLElement | null;
  setSidebarEl: (el: HTMLElement | null) => void;
}

const Ctx = createContext<Ws | null>(null);
const KEY = "tl-run";

function load(): RunState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Omit<RunState, "files">;
    return { ...r, files: [] };
  } catch { return null; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<RunState | null>(load);
  const [draftTitle, setDraftTitle] = useState("");
  const [filters, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [sidebarEl, setSidebarEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    try {
      if (run) { const { files: _f, ...rest } = run; sessionStorage.setItem(KEY, JSON.stringify(rest)); }
      else sessionStorage.removeItem(KEY);
    } catch { /* ignore */ }
  }, [run]);

  const refreshReady = useCallback(() => { readiness().then(setReady).catch(() => setReady(null)); }, []);
  useEffect(() => {
    refreshReady();
    const id = setInterval(refreshReady, 60_000);
    return () => clearInterval(id);
  }, [refreshReady]);

  const setFilters = useCallback((patch: Partial<Filters>) => setF((f) => ({ ...f, ...patch })), []);
  const resetFilters = useCallback(() => setF(DEFAULT_FILTERS), []);

  const value = useMemo<Ws>(() => ({
    run, setRun, draftTitle, setDraftTitle, filters, setFilters, resetFilters, ready, refreshReady, sidebarEl, setSidebarEl,
  }), [run, draftTitle, filters, setFilters, resetFilters, ready, refreshReady, sidebarEl]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return c;
}

/** Render children into the context sidebar (the 300px column beside the rail). */
export function Sidebar({ children }: { children: ReactNode }) {
  const { sidebarEl } = useWorkspace();
  if (!sidebarEl) return null;
  return createPortal(<>{children}</>, sidebarEl);
}
