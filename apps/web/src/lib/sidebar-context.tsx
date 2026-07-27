'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

/** localStorage-Schlüssel für die persistente Sichtbarkeit auf Desktop. */
const VISIBLE_KEY = 'ad-wiki.sidebar.visible';

interface SidebarContextValue {
  /** Persistente Sichtbarkeit der Desktop-Sidebar (≥ lg). */
  desktopVisible: boolean;
  /** Overlay-Zustand unterhalb von lg (Tablet/Mobile). */
  mobileOpen: boolean;
  /** Viewport-abhängiger Toggle: Desktop → einklappen, sonst Overlay. */
  toggle: () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

/** True, wenn der Desktop-Breakpoint (lg = 1024px) aktiv ist. */
function isDesktopViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
}

/**
 * Stellt den Sidebar-Zustand app-weit bereit, damit sowohl die (globale) Navbar
 * als auch die Wiki-Sidebar denselben Toggle steuern. Sichtbarkeit wird in
 * localStorage gehalten; das Mobile-Overlay ist bewusst flüchtig und schließt
 * bei jedem Routenwechsel.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Server und erster Client-Render nutzen denselben Default → keine Hydration-Diskrepanz.
  const [desktopVisible, setDesktopVisible] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Gespeicherten Sichtbarkeits-Zustand nach dem Mount übernehmen.
  useEffect(() => {
    const stored = window.localStorage.getItem(VISIBLE_KEY);
    if (stored !== null) setDesktopVisible(stored === 'true');
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VISIBLE_KEY, String(desktopVisible));
  }, [desktopVisible]);

  // Overlay bei Navigation schließen, damit die Sidebar nicht offen bleibt.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggle = useCallback(() => {
    if (isDesktopViewport()) {
      setDesktopVisible((v) => !v);
    } else {
      setMobileOpen((v) => !v);
    }
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  // Tastatur-Shortcut Ctrl/Cmd+B (wie in VS Code).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  return (
    <SidebarContext.Provider value={{ desktopVisible, mobileOpen, toggle, closeMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar muss innerhalb von <SidebarProvider> verwendet werden.');
  }
  return ctx;
}
