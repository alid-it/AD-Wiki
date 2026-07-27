'use client';

import { useTranslations } from 'next-intl';
import { useLocaleSwitcher } from '@/lib/i18n-context';

/**
 * Kompakter DE/EN-Umschalter für die Navbar. Bei zwei Sprachen genügt ein
 * Toggle: der Button zeigt das aktuelle Kürzel und wechselt bei Klick sofort
 * (ohne Reload, ohne URL-Änderung) zur jeweils anderen Sprache.
 */
export function LanguageSwitcher() {
  const t = useTranslations('language');
  const { locale, setLocale } = useLocaleSwitcher();
  const next = locale === 'de' ? 'en' : 'de';

  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      aria-label={t('switch')}
      title={t('switch')}
      className="flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
    >
      {locale}
    </button>
  );
}
