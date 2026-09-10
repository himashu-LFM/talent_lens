/* Workspace state shared across the app shell: the active organization and the
   signed-in user's role in it, the active screening run (what the Shortlist page
   and the context sidebar show), shortlist filters, the sidebar slot element
   pages portal into, and backend readiness. */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { readiness, type Readiness, type ScreenResponse } from "../api";
import { useAuth } from "../auth/AuthProvider";
import {
  listMembers, myMemberships, setActiveOrg as persistActiveOrg,
  type Member, type Membership, type Org, type ReviewStatus, type Role,
} from "../lib/db";

export type RunSource = "upload" | "gmail" | "auto" | "history";
export interface RunState {
  data: ScreenResponse;
  runId: string | null;
  /** Original File objects (same-session uploads only). Re-opened runs stream
   *  the stored copy from Supabase Storage instead. */
  files: File[];
  title: string;
  source: RunSource;
  jobId: string | null;
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
  assignee: "all" | "mine" | "unassigned";
}
const DEFAULT_FILTERS: Filters = {
  query: "", minScore: 0, status: "all", anon: false,
  view: "table", sort: "score", assignee: "all",
};

interface Ws {
  /* org */
  memberships: Membership[];
  org: Org | null;
  orgId: string;
  role: Role | null;
  members: Member[];
  orgLoading: boolean;
  switchOrg: (orgId: string) => void;
  refreshOrgs: () => Promise<void>;
  /* run */
  run: RunState | null;
  setRun: Dispatch<SetStateAction<RunState | null>>;
  draftTitle: string;
  setDraftTitle: (s: string) => void;
  /* filters */
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  resetFilters: () => void;
  /* backend */
  ready: Readiness | null;
  refreshReady: () => void;
  /* sidebar portal */
  sidebarEl: HTMLElement | null;
  setSidebarEl: (el: HTMLElement | null) => void;
}

const Ctx = createContext<Ws | null>(null);
const RUN_KEY = "tl-run";
const ORG_KEY = "tl-org";

function loadRun(): RunState | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Omit<RunState, "files">;
    return { ...r, files: [], jobId: r.jobId ?? null };
  } catch { return null; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, configured } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [orgId, setOrgId] = useState<string>(() => {
    try { return localStorage.getItem(ORG_KEY) ?? ""; } catch { return ""; }
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [orgLoading, setOrgLoading] = useState(true);

  const [run, setRun] = useState<RunState | null>(loadRun);
  const [draftTitle, setDraftTitle] = useState("");
  const [filters, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [sidebarEl, setSidebarEl] = useState<HTMLElement | null>(null);

  /* ---- organizations ---- */
  const refreshOrgs = useCallback(async () => {
    if (!configured || !user) { setOrgLoading(false); return; }
    try {
      const rows = await myMemberships();
      setMemberships(rows);
      setOrgId((cur) => {
        if (cur && rows.some((m) => m.org_id === cur)) return cur;
        return rows[0]?.org_id ?? "";
      });
    } catch {
      setMemberships([]);
    } finally {
      setOrgLoading(false);
    }
  }, [configured, user]);

  useEffect(() => { refreshOrgs(); }, [refreshOrgs]);

  useEffect(() => {
    try { if (orgId) localStorage.setItem(ORG_KEY, orgId); } catch { /* ignore */ }
  }, [orgId]);

  useEffect(() => {
    if (!orgId || !configured) { setMembers([]); return; }
    listMembers(orgId).then(setMembers).catch(() => setMembers([]));
  }, [orgId, configured]);

  const switchOrg = useCallback((next: string) => {
    setOrgId(next);
    setRun(null);              // runs belong to one org; don't leak across
    setF(DEFAULT_FILTERS);
    if (user) persistActiveOrg(user.id, next).catch(() => {});
  }, [user]);

  const membership = useMemo(
    () => memberships.find((m) => m.org_id === orgId) ?? null,
    [memberships, orgId]
  );

  /* ---- active run ---- */
  useEffect(() => {
    try {
      if (run) { const { files: _f, ...rest } = run; sessionStorage.setItem(RUN_KEY, JSON.stringify(rest)); }
      else sessionStorage.removeItem(RUN_KEY);
    } catch { /* ignore */ }
  }, [run]);

  /* ---- backend readiness ---- */
  const refreshReady = useCallback(() => {
    readiness().then(setReady).catch(() => setReady(null));
  }, []);
  useEffect(() => {
    refreshReady();
    const id = setInterval(refreshReady, 60_000);
    return () => clearInterval(id);
  }, [refreshReady]);

  const setFilters = useCallback((patch: Partial<Filters>) => setF((f) => ({ ...f, ...patch })), []);
  const resetFilters = useCallback(() => setF(DEFAULT_FILTERS), []);

  const value = useMemo<Ws>(() => ({
    memberships,
    org: (membership?.organizations as Org | undefined) ?? null,
    orgId,
    role: membership?.role ?? null,
    members,
    orgLoading,
    switchOrg,
    refreshOrgs,
    run, setRun, draftTitle, setDraftTitle,
    filters, setFilters, resetFilters,
    ready, refreshReady,
    sidebarEl, setSidebarEl,
  }), [memberships, membership, orgId, members, orgLoading, switchOrg, refreshOrgs,
       run, draftTitle, filters, setFilters, resetFilters, ready, refreshReady, sidebarEl]);

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

/** Name for a teammate id, for comments and assignment. */
export function useMemberName() {
  const { members } = useWorkspace();
  return useCallback((id?: string | null) => {
    if (!id) return "Unassigned";
    const m = members.find((x) => x.user_id === id);
    return m?.full_name || m?.email || "Teammate";
  }, [members]);
}
