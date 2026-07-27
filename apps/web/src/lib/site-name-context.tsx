'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { settings as settingsApi } from '@ad-wiki/api-client';

const DEFAULT_SITE_NAME = 'AD-Wiki';

interface SiteNameContextValue {
  siteName: string;
  setSiteName: (value: string) => void;
}

const SiteNameContext = createContext<SiteNameContextValue | null>(null);

/** Hält das öffentliche Plattform-Branding für Navbar und Seitentitel synchron. */
export function SiteNameProvider({ children }: { children: ReactNode }) {
  const [siteName, setSiteNameState] = useState(DEFAULT_SITE_NAME);

  const setSiteName = useCallback((value: string) => {
    const normalized = value.trim();
    setSiteNameState(normalized || DEFAULT_SITE_NAME);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    settingsApi.getBranding(controller.signal)
      .then((branding) => setSiteName(branding.siteName))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSiteNameState(DEFAULT_SITE_NAME);
        }
      });
    return () => controller.abort();
  }, [setSiteName]);

  useEffect(() => {
    document.title = siteName;
  }, [siteName]);

  const value = useMemo(() => ({ siteName, setSiteName }), [siteName, setSiteName]);

  return <SiteNameContext.Provider value={value}>{children}</SiteNameContext.Provider>;
}

export function useSiteName(): SiteNameContextValue {
  const context = useContext(SiteNameContext);
  if (!context) throw new Error('useSiteName muss innerhalb des SiteNameProvider verwendet werden.');
  return context;
}
