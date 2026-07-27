'use client';

import { useTranslations } from 'next-intl';

/** Statusabhängiges Badge (Entwurf/Archiviert) neben dem Artikeltitel. */
export function ArticleStatusBadge({ status }: { status: string }) {
  const t = useTranslations('wiki');
  if (status === 'published') return null;
  const label = status === 'draft' ? t('statusDraft') : t('statusArchived');
  const tone =
    status === 'draft' ? 'bg-warning-50 text-warning-600' : 'bg-background text-muted';
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

/** Hinweis für einen Artikel ohne Inhalt. */
export function ArticleEmptyContent() {
  const t = useTranslations('wiki');
  return <p className="text-sm text-muted">{t('noContent')}</p>;
}
