/* App shell: 84px icon rail · 300px context sidebar · main column with a sticky
   glass header. Pages fill the sidebar through <Sidebar> (a portal slot). */
import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3, Bell, Building2, CalendarClock, Check, ChevronDown, History as HistoryIcon,
  Inbox, ListOrdered, LogOut, Plus, ScanLine, Search, Settings as SettingsIcon, Users,
} from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { applyTheme, getTheme, type Theme } from "../lib/theme";
import { useWorkspace } from "../context/Workspace";
import { ROLE_LABEL, createOrg } from "../lib/db";
import { Avatar, Badge, Eyebrow, initialsOf } from "./ds";
import { LogoTile } from "./Logo";
import CommandPalette, { useCommandPalette } from "./CommandPalette";
import { useToast } from "./Toast";

const NAV = [
  { to: "/", label: "Screen", icon: ScanLine, end: true },
  { to: "/shortlist", label: "Shortlist", icon: ListOrdered },
  { to: "/jobs", label: "Jobs", icon: CalendarClock },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/talent", label: "Pool", icon: Users },
  { to: "/analytics", label: "Insights", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const TITLES: Record<string, [string, string]> = {
  "/": ["New screening run", "Define the role, add resumes, get a ranked shortlist"],
  "/shortlist": ["Shortlist", "Ranked candidates with evidence"],
  "/jobs": ["Jobs & interviews", "Open roles, apply links and interview slots"],
  "/inbox": ["Applications", "Everything that came in through your apply links"],
  "/history": ["Screening history", "Every run, re-openable with its statuses and notes"],
  "/talent": ["Talent pool", "Everyone you have ever screened, searchable"],
  "/analytics": ["Insights", "Funnel, trends and skill gaps"],
  "/settings": ["Settings", "Team, connections, templates and compliance"],
  "/profile": ["Profile", "Your account and screening activity"],
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut, configured } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const {
    run, draftTitle, ready, setSidebarEl,
    memberships, org, orgId, role, switchOrg, refreshOrgs,
  } = useWorkspace();
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [orgMenu, setOrgMenu] = useState(false);
  const cmd = useCommandPalette();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOrgMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const doSignOut = async () => { await signOut(); nav("/login"); };

  async function newTeam() {
    const name = window.prompt("Name for the new team");
    if (!name?.trim() || !user) return;
    try {
      const created = await createOrg(user.id, name.trim());
      await refreshOrgs();
      switchOrg(created.id);
      setOrgMenu(false);
      toast.success(`Team “${created.name}” created — you're the admin.`);
    } catch (e) {
      toast.error(`Couldn't create the team: ${e instanceof Error ? e.message : ""}`);
    }
  }

  const idx = NAV.findIndex((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  const [title, sub] = useMemo(() => {
    const base = TITLES[loc.pathname] ?? ["TalentLens", ""];
    if (loc.pathname === "/shortlist" && run) {
      return [base[0], `${run.title || run.data.job.title || "Untitled role"} · ${run.data.total_resumes} screened · ${run.data.top.length} shortlisted`];
    }
    return base;
  }, [loc.pathname, run]);

  const name = (user?.user_metadata?.full_name as string) || user?.email || "You";
  const pending = ready?.unacked_auto_results ?? 0;
  const roleTitle = (loc.pathname === "/" && draftTitle) ? draftTitle : run?.title || run?.data.job.title || draftTitle;

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>

      <nav className="rail" aria-label="Primary">
        <button className="rail-logo" onClick={() => nav("/")} title="TalentLens" aria-label="TalentLens home">
          <LogoTile size={46} radius={15} glyph={28} />
        </button>
        <div className="rail-nav">
          <div className="rail-pill" style={{ transform: `translateY(${Math.max(idx, 0) * 62}px)`, opacity: idx < 0 ? 0 : 1 }} aria-hidden />
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `rail-item ${isActive ? "on" : ""}`} aria-label={label}>
              <Icon size={19} />
              <span>{label}</span>
              {to === "/" && pending > 0 && <span className="nav-badge" aria-label={`${pending} new auto-screened batches`}>{pending}</span>}
            </NavLink>
          ))}
        </div>
        <div className="rail-spacer" />
        {configured && (
          <button className="rail-ghost" onClick={doSignOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
        )}
        <button className="rail-avatar" onClick={() => nav("/profile")} title="Profile" aria-label="Profile">
          <Avatar initials={initialsOf(name)} tone="emerald" size={40} />
        </button>
      </nav>

      <aside className="ctx" aria-label="Context">
        <div className="ctx-org" ref={menuRef}>
          <button className="org-btn" onClick={() => setOrgMenu((m) => !m)}
            aria-haspopup="menu" aria-expanded={orgMenu} disabled={!configured}>
            <Building2 size={15} />
            <span className="ellipsis">{org?.name || (configured ? "No team" : "Local mode")}</span>
            {role && <Badge variant={role === "admin" ? "warning" : "neutral"}>{ROLE_LABEL[role]}</Badge>}
            {configured && <ChevronDown size={14} className="org-caret" />}
          </button>
          {orgMenu && (
            <div className="org-menu" role="menu">
              <div className="org-menu-head">Your teams</div>
              {memberships.map((m) => {
                const o = m.organizations as { id: string; name: string } | undefined;
                return (
                  <button key={m.org_id} role="menuitem" className={`org-item ${m.org_id === orgId ? "on" : ""}`}
                    onClick={() => { switchOrg(m.org_id); setOrgMenu(false); }}>
                    <span className="ellipsis">{o?.name || "Team"}</span>
                    <span className="org-role">{ROLE_LABEL[m.role]}</span>
                    {m.org_id === orgId && <Check size={14} />}
                  </button>
                );
              })}
              {!memberships.length && <div className="org-empty">You're not in a team yet.</div>}
              <button role="menuitem" className="org-item new" onClick={newTeam}>
                <Plus size={14} /> New team
              </button>
            </div>
          )}
        </div>

        <div className="ctx-head">
          <Eyebrow amber tight>Active role</Eyebrow>
          <div className="ctx-title" title={roleTitle || undefined}>{roleTitle || "No role yet"}</div>
          <div className="ctx-meta">
            {run ? `${run.data.total_resumes} screened · ${run.data.top.length} shortlisted · ${shortDate(run.at)}` : "Describe a role and add resumes to start"}
          </div>
        </div>

        <div className="ctx-body" ref={setSidebarEl} key={loc.pathname} />

        <div className="ctx-foot">
          <span className={`pulse-dot ${ready ? "" : "off"}`} />
          <span className="ellipsis">
            {ready ? (ready.semantic_model === "ready" ? "Engine ready · offline" : "Engine ready · lexical mode") : "Connecting to engine…"}
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="main-head">
          <h1 className="main-title">{title}</h1>
          <span className="main-sub">{sub}</span>
          <div className="grow" />
          {role === "viewer" && <Badge variant="neutral">Read-only</Badge>}
          <button className="cmd-btn" onClick={() => cmd.setOpen(true)} aria-label="Open command palette">
            <Search size={14} /><span>Search</span><kbd>⌘K</kbd>
          </button>
          <button className="icon-btn" onClick={() => nav("/")} aria-label={pending ? `${pending} new auto-screened batches` : "Notifications"} title="Auto-screen results">
            <Bell size={16} />
            {pending > 0 && <span className="nav-badge">{pending}</span>}
          </button>
        </header>
        <div id="main" className="main-body">
          <div key={loc.pathname} className="fade-in">{children}</div>
        </div>
      </main>

      <CommandPalette open={cmd.open} onClose={() => cmd.setOpen(false)} theme={theme} onToggleTheme={toggleTheme} onSignOut={doSignOut} />
    </div>
  );
}
