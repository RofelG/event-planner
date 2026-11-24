import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { initials, roleLabel } from '../lib/format';
import { ChangePasswordModal } from './ChangePasswordModal';

const linkClass = ({ isActive }) =>
  `press rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
  }`;

export function NavBar() {
  const { user, isPlanner, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menus on navigation and on outside click.
  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => !menuRef.current?.contains(e.target) && setMenuOpen(false);
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // Links are shown by role for convenience only; the API enforces access.
  const links = (
    <>
      <NavLink to="/" end className={linkClass}>Events</NavLink>
      {isPlanner && <NavLink to="/manage" className={linkClass}>Manage Events</NavLink>}
      {isAdmin && <NavLink to="/admin" className={linkClass}>Users and Groups</NavLink>}
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6" aria-label="Main">
        <NavLink to="/" className="flex items-center gap-2.5 font-semibold text-ink-900">
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <span>Event Planner</span>
        </NavLink>

        <div className="hidden items-center gap-1 md:flex">{links}</div>

        <div className="ml-auto flex items-center gap-2">
          {isPlanner && (
            <button
              type="button"
              onClick={() => navigate('/manage/new')}
              className="press hidden h-9 items-center rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700 sm:inline-flex"
            >
              Create event
            </button>
          )}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="press flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-ink-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {initials(`${user.first} ${user.last}`)}
              </span>
              <span className="hidden text-sm font-medium text-ink-700 sm:block">{user.first}</span>
            </button>
            {menuOpen && (
              <div role="menu" className="anim-menu absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
                <div className="border-b border-ink-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-ink-900">{user.first} {user.last}</p>
                  <p className="truncate text-xs text-ink-500">{user.email}</p>
                  <p className="mt-1 text-xs font-medium text-brand-700">{roleLabel[user.role]}</p>
                </div>
                <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); setPasswordOpen(true); }} className="block w-full px-4 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50">
                  Change password
                </button>
                <button role="menuitem" type="button" onClick={signOut} className="block w-full border-t border-ink-100 px-4 py-2.5 text-left text-sm text-ink-700 hover:bg-ink-50">
                  Sign out
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="press rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 md:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((o) => !o)}
          >
            Menu
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div id="mobile-nav" className="anim-drop flex flex-col gap-1 border-t border-ink-100 px-4 py-3 md:hidden">
          {links}
          {isPlanner && <NavLink to="/manage/new" className={linkClass}>Create event</NavLink>}
        </div>
      )}

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </header>
  );
}
