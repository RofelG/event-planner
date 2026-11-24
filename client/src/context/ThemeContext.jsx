import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { THEMES, applyTheme, onSystemThemeChange, readTheme, resolveTheme, storeTheme } from '../lib/theme';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readTheme);
  // Bumped when the OS theme changes so `resolved` re-computes in System mode.
  const [systemTick, setSystemTick] = useState(0);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;
    return onSystemThemeChange(() => {
      applyTheme('system');
      setSystemTick((n) => n + 1);
    });
  }, [theme]);

  const setTheme = useCallback((next) => {
    storeTheme(next);
    setThemeState(next);
  }, []);

  /** System, then Light, then Dark, then back to System. */
  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
      storeTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, resolved: resolveTheme(theme), setTheme, cycleTheme }),
    // systemTick is listed so `resolved` updates when the OS theme flips.
    [theme, systemTick, setTheme, cycleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
