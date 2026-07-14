import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import Logo from "./Logo";

function initials(nameOrEmail: string) {
  const base = nameOrEmail.split("@")[0];
  const parts = base.split(/[.\s_]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);

  const name =
    (user?.user_metadata?.full_name as string) || user?.email || "User";

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-brand" onClick={() => nav("/")} role="button">
            <Logo />
            <div className="brand-text">
              <span className="brand-name">TalentLens</span>
              <span className="brand-by">by ListenFirst</span>
            </div>
          </div>

          <nav className="mainnav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "")}>
              Dashboard
            </NavLink>
            <NavLink to="/history" className={({ isActive }) => (isActive ? "on" : "")}>
              History
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => (isActive ? "on" : "")}>
              Profile
            </NavLink>
          </nav>

          <div className="usermenu">
            <button className="avatar" onClick={() => setMenu((m) => !m)}>
              {initials(name)}
            </button>
            {menu && (
              <>
                <div className="menu-scrim" onClick={() => setMenu(false)} />
                <div className="menu-pop">
                  <div className="menu-id">
                    <div className="menu-name">{name}</div>
                    <div className="menu-email">{user?.email}</div>
                  </div>
                  <button onClick={() => { setMenu(false); nav("/profile"); }}>
                    Profile
                  </button>
                  <button onClick={() => { setMenu(false); nav("/history"); }}>
                    History
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      setMenu(false);
                      await signOut();
                      nav("/login");
                    }}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {children}

      <footer className="footer">
        TalentLens · ListenFirst — FastAPI + Supabase · rule-based offline scoring
      </footer>
    </div>
  );
}
