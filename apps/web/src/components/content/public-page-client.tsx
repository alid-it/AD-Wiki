'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { pages } from '@ad-wiki/api-client';
import type { PublicPage } from '@ad-wiki/shared-types';
import { ArticleContent } from '@/components/content/article-content';
import { useTranslations } from 'next-intl';

export function PublicPageClient({ slug }: { slug: string }) {
  const t = useTranslations('publicPage');
  const [page, setPage] = useState<PublicPage | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    pages.publicBySlug(slug, controller.signal).then(setPage).catch(() => setNotFound(true));
    return () => controller.abort();
  }, [slug]);

  if (!page && !notFound) return <main className="flex min-h-screen items-center justify-center bg-white"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></main>;
  if (!page) return <main className="flex min-h-screen items-center justify-center bg-white p-6 text-center"><div><FileText className="mx-auto mb-3 h-9 w-9 text-slate-400" /><h1 className="text-xl font-semibold text-slate-900">{t('notFoundTitle')}</h1><p className="mt-2 text-sm text-slate-600">{t('notFoundText')}</p></div></main>;

  return <main className="min-h-screen bg-white py-10 text-slate-900 sm:py-16"><article className="mx-auto max-w-4xl px-5 sm:px-8"><header className="mb-8 border-b border-slate-200 pb-6"><p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('label')}</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1><p className="mt-3 text-sm text-slate-500">{t('updatedAt', { date: new Date(page.updatedAt).toLocaleDateString() })}</p></header><div className="public-article"><ArticleContent content={page.content} /></div></article></main>;
}
