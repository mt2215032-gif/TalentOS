'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

/**
 * Theme control.
 *
 * Three states: 'light', 'dark', and 'system'. System is the default and stores
 * nothing, so the OS preference keeps working. An explicit choice writes a
 * data-theme attribute, which the CSS treats as authoritative over the media
 * query in both directions.
 */

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'talentos-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** What is actually being displayed right now. */
  resolved: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolved: 'light',
});

/**
 * Reads the stored preference through an external store rather than an effect,
 * so the value is correct on the first client render instead of arriving one
 * render later — which would flash the wrong theme.
 */
const themeListeners = new Set<() => void>();

function subscribeToTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  // Another tab changing the preference should update this one too.
  window.addEventListener('storage', listener);
  return () => {
    themeListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    // localStorage throws in some privacy modes; a theme is never worth a crash.
    return 'system';
  }
}

/** The server has no preference to read, so it always renders "system". */
const readServerTheme = (): Theme => 'system';

function subscribeToSystemScheme(listener: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

const readSystemScheme = (): 'light' | 'dark' =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const readServerScheme = (): 'light' | 'dark' => 'light';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, readStoredTheme, readServerTheme);
  const systemScheme = useSyncExternalStore(
    subscribeToSystemScheme,
    readSystemScheme,
    readServerScheme,
  );

  const resolved: 'light' | 'dark' = theme === 'system' ? systemScheme : theme;

  // Reflect the choice onto the document. This writes to the DOM rather than to
  // React state, which is exactly what an effect is for.
  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The preference simply will not persist.
    }
    // Notify this tab; the storage event only fires in *other* tabs.
    for (const listener of themeListeners) listener();
  }, []);

  const value = useMemo(() => ({ theme, setTheme, resolved }), [theme, setTheme, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme, resolved } = useTheme();

  const cycle = (): void => {
    setTheme(theme === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] ${className}`}
      aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
    >
      {resolved === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}
