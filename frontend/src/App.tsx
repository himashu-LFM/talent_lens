import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import { EmptyState } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import Landing from "./pages/Landing";
import Settings from "./pages/Settings";
import TalentPool from "./pages/TalentPool";
import Analytics from "./pages/Analytics";

function Boot() {
  return <div className="boot"><div className="boot-spinner" /></div>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const loc = useLocation();
  if (loading) return <Boot />;
  if (configured && !user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <Layout>{children}</Layout>;
}

/** "/" shows the public landing page to visitors and the dashboard to signed-in users. */
function Home() {
  const { user, loading, configured } = useAuth();
  if (loading) return <Boot />;
  if (configured && !user) return <Landing />;
  return <Layout><Dashboard /></Layout>;
}

function NotFound() {
  return (
    <main className="page">
      <EmptyState icon={<Compass size={30} />} title="Page not found" body={<>That link doesn't exist. <Link to="/">Back to the dashboard</Link>.</>} />
    </main>
  );
}

export default function App() {
  const { user, configured } = useAuth();
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={configured && user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/history" element={<Protected><History /></Protected>} />
        <Route path="/talent" element={<Protected><TalentPool /></Protected>} />
        <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
        <Route path="/settings" element={<Protected><Settings /></Protected>} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="*" element={<Protected><NotFound /></Protected>} />
      </Routes>
    </ErrorBoundary>
  );
}
