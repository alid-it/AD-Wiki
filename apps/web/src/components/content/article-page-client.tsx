'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { pages } from '@ad-wiki/api-client';
import type { PageDetail } from '@ad-wiki/shared-types';
import { ArticleContent } from '@/components/content/article-content';
import { ArticleInfo } from '@/components/content/article-info';
import { PagePresence } from '@/components/content/page-presence';
import { PageLiveRefresh } from '@/components/content/page-live-refresh';
import { ArticleStatusBadge, ArticleEmptyContent } from '@/components/content/article-read-bits';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import { ArticleBreadcrumbs } from '@/components/content/article-breadcrumbs';
import { TableOfContents } from '@/components/content/table-of-contents';
import { extractArticleHeadings } from '@/lib/article-headings';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

export function ArticlePageClient({ slug }: { slug: string }) {
  const router = useRouter();
  const t = useTranslations('checklists');
  const tw = useTranslations('wiki');
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission('pages', 'update');
  const [page, setPage] = useState<PageDetail | null>(null);
  useEffect(() => {
    let activeController: AbortController | null = null;

    const reload = () => {
      activeController?.abort();
      activeController = new AbortController();
      pages
        .bySlug(slug, activeController.signal)
        .then(setPage)
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setPage(null);
          router.replace('/wiki');
        });
    };

    reload();
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reload);
    return () => {
      activeController?.abort();
      window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reload);
    };
  }, [router, slug]);
  const headings = useMemo(() => extractArticleHeadings(page?.content ?? ''), [page?.content]);
  const showTableOfContents = headings.length >= 3;
  if (!page) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  return (
    <div className="article-page-shell mx-auto flex max-w-[1400px] flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:items-start lg:gap-8 lg:p-8">
      <article className="article-main min-w-0 flex-1 lg:max-w-5xl">
        <ArticleBreadcrumbs page={page} wikiLabel={tw('breadcrumbWiki')} />
        <header className="article-header mb-6 border-b border-border pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{page.title}</h1>
            <span className="no-print"><ArticleStatusBadge status={page.status} /></span>
          </div>
          <div className="no-print mt-3 min-h-7"><PagePresence pageId={page.id} /></div>
          <div className="no-print"><PageLiveRefresh pageId={page.id} /></div>
        </header>
        {showTableOfContents && (
          <div className="mb-6 lg:hidden">
            <TableOfContents headings={headings} title={tw('articleTableOfContents')} collapsible />
          </div>
        )}
        {page.content.trim() ? (
          <ArticleContent
            content={page.content}
            onCheckboxChange={canUpdate ? async (checkboxIndex, checked) => {
              try {
                const updated = await pages.toggleCheckbox(page.id, { checkboxIndex, checked });
                setPage((current) => current ? { ...current, content: updated.content, updatedAt: updated.updatedAt } : current);
              } catch (error) {
                toast.error(t('updateFailed'));
                throw error;
              }
            } : undefined}
          />
        ) : <ArticleEmptyContent />}
      </article>
      <aside className="article-sidebar w-full shrink-0 lg:w-72">
        {showTableOfContents && (
          <div className="mb-4 hidden lg:block">
            <TableOfContents headings={headings} title={tw('articleTableOfContents')} />
          </div>
        )}
        <ArticleInfo page={page} />
      </aside>
    </div>
  );
}
