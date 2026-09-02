import { Suspense, lazy } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import { EmptyState } from "./components/ui";

// Route-level code splitting: each page loads on first visit.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const History = lazy(() => import("./pages/History"));
const Profile = lazy(() => import("./pages/Profile"));
const Login = lazy(() => import("./pages/Login"));
const Landing = lazy(() => import("./pages/Landing"));
const Settings = lazy(() => import("./pages/Settings"));
const TalentPool = lazy(() => import("./pages/TalentPool"));
const Analytics = lazy(() => import("./pages/Analytics"));

function Boot() {
  return <div className="boot" role="status" aria-label="Loading"><div className="boot-spinner" /></div>;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const loc = useLocation();
  if (loading) return <Boot />;
  if (configured && !user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <Layout>{children}</Layout>;
}

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
      <Suspense fallback={<Boot />}>
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
      </Suspense>
    </ErrorBoundary>
  );
}
