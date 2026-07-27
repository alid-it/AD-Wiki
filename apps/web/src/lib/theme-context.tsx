'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** Vom Nutzer gewählter Modus. `system` folgt der Betriebssystem-Einstellung. */
export type ThemeMode = 'light' | 'dark' | 'system';
/** Tatsächlich angewandtes Thema (nach Auflösung von `system`). */
export type ResolvedTheme = 'light' | 'dark';

/** localStorage-Schlüssel – identisch mit dem No-FOUC-Script in layout.tsx. */
export const THEME_STORAGE_KEY = 'ad-wiki-theme';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Löst `system` anhand der aktuellen OS-Preference auf. */
function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** Setzt die passende Klasse am <html> und das native `color-scheme`. */
function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

/**
 * Stellt Theme-Modus und -Umschaltung bereit. Der Modus liegt in localStorage;
 * die konkrete Klasse setzt bereits das No-FOUC-Script vor dem ersten Paint,
 * sodass hier nur der React-State synchronisiert und auf Änderungen reagiert wird.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Gespeicherten Modus nach dem Mount übernehmen (vermeidet Hydration-Mismatch).
  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null) ?? 'system';
    const r = resolve(stored);
    setThemeState(stored);
    setResolvedTheme(r);
    applyTheme(r);
    // Sanfte Übergänge erst nach dem Laden aktivieren (kein Farb-Flash).
    requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-transitions');
    });
  }, []);

  // Im Modus „system" auf OS-Wechsel live reagieren.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r = mq.matches ? 'dark' : 'light';
      setResolvedTheme(r);
      applyTheme(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    const r = resolve(mode);
    setResolvedTheme(r);
    applyTheme(r);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Zugriff auf Theme-Modus und -Umschaltung. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme muss innerhalb von <ThemeProvider> verwendet werden.');
  }
  return ctx;
}
