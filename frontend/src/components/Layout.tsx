import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, History as HistoryIcon, LayoutDashboard, LogOut, Menu, Moon, Search, Settings as SettingsIcon, Sun, User, Users, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { readiness } from "../api";
import { applyTheme, getTheme, type Theme } from "../pages/Settings";
import Logo, { Wordmark } from "./Logo";
import { PageTransition } from "./ui";
import CommandPalette, { useCommandPalette } from "./CommandPalette";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/history", label: "History", icon: HistoryIcon },
  { to: "/talent", label: "Talent pool", icon: Users },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function initials(s: string) {
  const parts = s.split("@")[0].split(/[.\s_]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [pending, setPending] = useState(0);
  const cmd = useCommandPalette();

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const tick = () => readiness().then((r) => setPending(r.unacked_auto_results)).catch(() => {});
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { setMobile(false); }, [loc.pathname]);

  const name = (user?.user_metadata?.full_name as string) || user?.email || "User";
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  const doSignOut = async () => { await signOut(); nav("/login"); };

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="noise" aria-hidden />
      <header className="topbar">
        <div className="topbar-inner">
          <button className="topbar-brand" onClick={() => nav("/")} aria-label="TalentLens home"><Logo /><Wordmark /></button>

          <nav className="mainnav" aria-label="Primary">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "on" : "")}>
                {({ isActive }) => (<>
                  {isActive && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                  <Icon size={16} /><span>{label}</span>
                  {to === "/" && pending > 0 && <span className="nav-badge" aria-label={`${pending} new auto-screened batches`}>{pending}</span>}
                </>)}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-right">
            <button className="cmd-btn" onClick={() => cmd.setOpen(true)} aria-label="Open command palette"><Search size={14} /><span>Search</span><kbd>ctrl</kbd><kbd>K</kbd></button>
            <button className="icon-btn" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }} style={{ display: "flex" }}>
                  {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                </motion.span>
              </AnimatePresence>
            </button>
            <div className="usermenu">
              <button className="avatar" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu">{initials(name)}</button>
              <AnimatePresence>
                {menu && (<>
                  <div className="menu-scrim" onClick={() => setMenu(false)} />
                  <motion.div className="menu-pop" role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
                    <div className="menu-id"><div className="menu-name">{name}</div><div className="menu-email">{user?.email}</div></div>
                    <button role="menuitem" onClick={() => { setMenu(false); nav("/profile"); }}><User size={15} /> Profile</button>
                    <button role="menuitem" onClick={() => { setMenu(false); nav("/settings"); }}><SettingsIcon size={15} /> Settings</button>
                    <button role="menuitem" className="danger" onClick={() => { setMenu(false); doSignOut(); }}><LogOut size={15} /> Sign out</button>
                  </motion.div>
                </>)}
              </AnimatePresence>
            </div>
            <button className="icon-btn mobile-only" onClick={() => setMobile((m) => !m)} aria-label="Menu" aria-expanded={mobile}>{mobile ? <X size={18} /> : <Menu size={18} />}</button>
          </div>
        </div>
        <AnimatePresence>
          {mobile && (
            <motion.nav className="mobilenav" aria-label="Primary mobile" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              {NAV.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "on" : "")}><Icon size={16} /> {label}</NavLink>)}
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <div id="main"><PageTransition k={loc.pathname}>{children}</PageTransition></div>

      <footer className="footer"><Logo size={18} /> <span>TalentLens · ListenFirst</span><span className="dot-sep" /><span>Hybrid offline scoring · scores assist review, never decide</span></footer>

      <CommandPalette open={cmd.open} onClose={() => cmd.setOpen(false)} theme={theme} onToggleTheme={toggleTheme} onSignOut={doSignOut} />
    </div>
  );
}
