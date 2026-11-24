// Theme preference: 'system' follows the OS setting; 'light' and 'dark' pin it.
// public/theme-init.js applies the stored choice before the app loads, using
// the same storage key and values.

export const THEMES = ['system', 'light', 'dark'];
const STORAGE_KEY = 'theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted, but still applied for this visit.
  }
}

/** The theme actually shown: 'light' or 'dark'. */
export function resolveTheme(theme) {
  if (theme === 'system') return darkQuery().matches ? 'dark' : 'light';
  return theme;
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

/** Calls back whenever the OS switches between light and dark. */
export function onSystemThemeChange(callback) {
  const query = darkQuery();
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
