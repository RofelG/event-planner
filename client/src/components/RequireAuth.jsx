import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NavBar } from './NavBar';
import { EmptyState, PageLoader } from './ui/Feedback';

/** Layout for signed-in pages. Redirects to /login when there is no session. */
export function RequireAuth() {
  const { user, status, demo } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <PageLoader label="Checking your session" />;
  // In demo mode `user` is a visitor stand-in, so this only redirects outside demo mode.
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  return (
    <div className="min-h-screen">
      <NavBar />
      {demo.enabled && (
        <div className="border-b border-brand-200 bg-brand-50 px-4 py-2 text-center text-xs text-brand-800 sm:text-sm">
          <span className="font-semibold">Demo mode.</span> Attendees are simulated, and events you create are removed after {demo.ttlHours} hours.
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Keyed by path so each route change replays the page entrance. */}
        <div key={location.pathname} className="anim-page">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/**
 * Hides a page from roles that cannot use it. This is a UX guard only; the
 * API independently rejects the same requests with 403.
 */
export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) {
    return (
      <EmptyState title="You do not have access to this page">
        This area is limited to {roles.includes('planner') ? 'event planners and admins' : 'admins'}. Ask an
        administrator if you need access.
      </EmptyState>
    );
  }
  return children;
}
