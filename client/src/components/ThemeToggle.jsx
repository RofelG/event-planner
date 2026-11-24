import { useTheme } from '../context/ThemeContext';

const LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
const NEXT = { system: 'light', light: 'dark', dark: 'system' };

// Outline icons drawn inline (no emoji, no icon font), sized to the text.
const icons = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  dark: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
};

/** One button that cycles System, Light, Dark. Shows the current mode. */
export function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={cycleTheme}
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[NEXT[theme]]}.`}
      title={`Theme: ${LABELS[theme]}`}
      className="press inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
    >
      {/* Keyed so the icon pops in each time the mode changes. */}
      <svg
        key={theme}
        className="anim-pop h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icons[theme]}
      </svg>
      <span className="hidden lg:inline">{LABELS[theme]}</span>
    </button>
  );
}
