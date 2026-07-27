'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, AlertCircle } from 'lucide-react';
import { pages, ApiClientError } from '@ad-wiki/api-client';
import type { Page } from '@ad-wiki/shared-types';
import { isHtmlContent } from '@/lib/content';
import { PageEditorForm, type EditorType } from '@/components/editor/page-editor-form';
import { EditorPresence } from '@/components/content/page-presence';

export default function EditPage() {
  const { slug } = useParams<{ slug: string }>();
  const t = useTranslations('editor.edit');
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await pages.bySlug(slug, controller.signal);
        setPage(result);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) {
          setError(t('notExist'));
        } else if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(t('loadFailed'));
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted" />
        <p className="mb-4 text-sm text-foreground">{error ?? t('notFound')}</p>
        <Link
          href="/wiki"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
        >
          {t('backToWiki')}
        </Link>
      </div>
    );
  }

  const editorType: EditorType = isHtmlContent(page.content) ? 'wysiwyg' : 'markdown';

  return (
    <>
      {/* Meldet „bearbeitet gerade", zeigt Presence und warnt bei Parallel-Bearbeitung. */}
      <div className="mx-auto max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8">
        <EditorPresence pageId={page.id} />
      </div>
      <PageEditorForm
        mode="edit"
        editorType={editorType}
        initialTitle={page.title}
        initialContent={page.content}
        initialStatus={page.status}
        initialIsPublic={page.isPublic}
        initialMcpVisible={page.mcpVisible}
        initialTags={page.tags}
        pageId={page.id}
        cancelHref={`/wiki/${page.slug}`}
      />
    </>
  );
}
