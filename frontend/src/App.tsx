import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Profile from "./pages/Profile";
import Login from "./pages/Login";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="boot">
        <div className="boot-spinner" />
      </div>
    );
  }
  // When Supabase isn't configured yet, let the app through so the UI is usable
  // (history/profile show a "configure me" state). Otherwise require a session.
  if (configured && !user) {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user, configured } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={configured && user ? <Navigate to="/" replace /> : <Login />}
      />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/history" element={<Protected><History /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
