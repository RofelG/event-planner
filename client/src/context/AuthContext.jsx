import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { reconnect } from '../lib/live';

const AuthContext = createContext(null);

/**
 * Stand-in user for demo visitors browsing without a session. The API treats
 * them the same way (public events only, nothing they can change).
 */
const VISITOR = Object.freeze({ id: 0, first: 'Visitor', last: '', role: 'visitor', isVisitor: true, groupIds: [] });

/**
 * App-wide session state. The user object (including role) comes from the
 * server; the client uses it only to decide what to show. Every action is
 * still authorized by the API.
 *
 * In demo mode (GET /api/demo), people without a session browse as VISITOR,
 * and becomeGuest(name) gives them a lightweight guest session.
 */
export function AuthProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [demo, setDemo] = useState({ enabled: false, ttlHours: null });
  const [status, setStatus] = useState('loading'); // loading | ready
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    Promise.all([
      api('/auth/me').then(setAccount).catch(() => setAccount(null)),
      api('/demo').then(setDemo).catch(() => {}),
    ]).finally(() => setStatus('ready'));

    const onExpired = () => {
      setAccount(null);
      setExpired(true);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  // The live stream is opened as whoever is signed in. When that changes (a
  // visitor gives a name, someone signs in or out), reconnect so updates carry
  // the new identity's permissions and "You are going" state.
  const lastId = useRef(undefined);
  useEffect(() => {
    const id = account?.id ?? null;
    if (lastId.current !== undefined && lastId.current !== id) reconnect();
    lastId.current = id;
  }, [account]);

  const login = useCallback(async (email, password) => {
    const me = await api('/auth/login', { method: 'POST', body: { email, password } });
    setExpired(false);
    setAccount(me);
    return me;
  }, []);

  const register = useCallback(async (fields) => {
    const me = await api('/auth/register', { method: 'POST', body: fields });
    setExpired(false);
    setAccount(me);
    return me;
  }, []);

  /** Demo mode: turns a visitor into a named guest. */
  const becomeGuest = useCallback(async (name) => {
    const me = await api('/demo/guest', { method: 'POST', body: { name } });
    setExpired(false);
    setAccount(me);
    return me;
  }, []);

  /** Saves account settings (e.g. { hideName }) and refreshes the signed-in user. */
  const updateSettings = useCallback(async (settings) => {
    const me = await api('/auth/settings', { method: 'PUT', body: settings });
    setAccount(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccount(null);
  }, []);

  const value = useMemo(() => {
    const user = account || (demo.enabled ? VISITOR : null);
    const role = user?.role;
    const isPlanner = role === 'planner' || role === 'admin';
    return {
      // The signed-in account, or VISITOR in demo mode, or null.
      user,
      // True only for a real session (account or guest), never for VISITOR.
      signedIn: Boolean(account),
      isVisitor: Boolean(user?.isVisitor),
      isGuest: Boolean(account?.isGuest),
      demo,
      status,
      expired,
      isPlanner,
      isAdmin: role === 'admin',
      // Who sees "Create event": planners, and in demo mode everyone (a
      // visitor is asked for a name first).
      canCreate: isPlanner || demo.enabled,
      login,
      register,
      becomeGuest,
      updateSettings,
      logout,
    };
  }, [account, demo, status, expired, login, register, becomeGuest, updateSettings, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
