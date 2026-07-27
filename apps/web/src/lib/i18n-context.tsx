'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { NextIntlClientProvider } from 'next-intl';
import de from '@/messages/de.json';
import en from '@/messages/en.json';

/** Unterstützte Sprachen. Standard ist Deutsch. */
export type Locale = 'de' | 'en';

export const LOCALE_STORAGE_KEY = 'ad-wiki-locale';
export const DEFAULT_LOCALE: Locale = 'de';

const MESSAGES = { de, en } as const;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en';
}

/**
 * Client-seitiger i18n-Provider (ohne URL-Routing). Die Sprache liegt in
 * localStorage; ein Wechsel re-rendert den `NextIntlClientProvider` sofort –
 * ohne Reload und ohne URL-Änderung. Passt zur clientseitigen Auth der App.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // Gespeicherte Sprache nach dem Mount übernehmen (kein Hydration-Mismatch,
  // da der Server-Render immer die Standardsprache nutzt).
  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) setLocaleState(stored);
  }, []);

  // `lang`-Attribut synchron halten (Barrierefreiheit, Rechtschreibprüfung).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      },
    }),
    [locale],
  );

  // Zeitzone des Browsers, damit next-intl Datums-/Zeitformate stabil rendert.
  const timeZone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'Europe/Berlin';

  return (
    <LocaleContext.Provider value={value}>
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone={timeZone}>
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

/** Zugriff auf die aktuelle Sprache und den Sprachwechsel. */
export function useLocaleSwitcher(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocaleSwitcher muss innerhalb von <I18nProvider> verwendet werden.');
  }
  return ctx;
}
