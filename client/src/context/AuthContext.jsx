import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

const AuthContext = createContext(null);

/**
 * App-wide session state. The user object (including role) comes from the
 * server; the client uses it only to decide what to show. Every action is
 * still authorized by the API.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setStatus('ready'));

    const onExpired = () => {
      setUser(null);
      setExpired(true);
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (email, password) => {
    const me = await api('/auth/login', { method: 'POST', body: { email, password } });
    setExpired(false);
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (fields) => {
    const me = await api('/auth/register', { method: 'POST', body: fields });
    setExpired(false);
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => {
    const role = user?.role;
    return {
      user,
      status,
      expired,
      isPlanner: role === 'planner' || role === 'admin',
      isAdmin: role === 'admin',
      login,
      register,
      logout,
    };
  }, [user, status, expired, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
