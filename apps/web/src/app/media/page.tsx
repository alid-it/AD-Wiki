'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, File, Loader2, Trash2, X } from 'lucide-react';
import { media, ApiClientError } from '@ad-wiki/api-client';
import type { Media } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { AuthenticatedMediaImage } from '@/components/content/authenticated-media-image';
import { isImageMime } from '@/lib/content';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

export default function MediaPage() {
  const t = useTranslations('media');
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const canRead = hasPermission('media', 'read');
  const canDelete = hasPermission('media', 'delete');
  const [items, setItems] = useState<Media[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Media | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const first = await media.list({ page: 1, limit: 100, scope: 'all' });
      const all = [...first.data];
      const pageCount = Math.ceil(first.meta.total / first.meta.perPage);
      for (let page = 2; page <= pageCount; page += 1) {
        const next = await media.list({ page, limit: 100, scope: 'all' });
        all.push(...next.data);
      }
      setItems(all);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canRead) void reload();
  }, [canRead, reload]);
  useEffect(() => {
    const reloadForAccessChange = () => {
      if (canRead) void reload();
    };
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
    return () => window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
  }, [canRead, reload]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await media.remove(pendingDelete.id);
      setItems((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  if (!canRead) return null;

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4 sm:p-5">
          <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('adminSubtitle')}</p>
        </div>

        {error && <div role="alert" className="m-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 sm:m-5"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : items.length === 0 ? <p className="py-16 text-center text-sm text-muted">{t('noMedia')}</p> : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <article key={item.id} className="grid grid-cols-[4rem_1fr_auto] gap-3 p-4 sm:grid-cols-[5rem_minmax(0,1.4fr)_minmax(9rem,0.8fr)_minmax(10rem,1fr)_auto] sm:items-center sm:gap-4 sm:px-5">
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-background text-muted">
                  {isImageMime(item.mimetype) ? <AuthenticatedMediaImage mediaId={item.id} alt={item.altText ?? item.filename} className="h-full w-full object-cover" loading="lazy" /> : <File className="h-5 w-5" />}
                </div>
                <div className="min-w-0 self-center">
                  <p className="truncate text-sm font-medium text-foreground" title={item.filename}>{item.filename}</p>
                  <p className="mt-0.5 text-xs text-muted sm:hidden">{item.uploadedBy?.displayName ?? t('unknownUser')} · {new Intl.DateTimeFormat(locale).format(new Date(item.createdAt))}</p>
                </div>
                <p className="hidden text-sm text-muted sm:block">{item.uploadedBy?.displayName ?? t('unknownUser')}</p>
                <div className="col-start-2 flex min-w-0 flex-wrap gap-1 sm:col-auto sm:block">
                  {item.pages.length === 0 ? <span className="text-xs text-muted">{t('unassigned')}</span> : item.pages.map((page) => <Link key={page.id} href={`/wiki/${page.slug}`} className="mr-1 inline-flex max-w-full cursor-pointer truncate rounded-md bg-accent-50 px-2 py-1 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100">{page.title}</Link>)}
                  <p className="mt-1 hidden text-xs text-muted sm:block">{new Intl.DateTimeFormat(locale).format(new Date(item.createdAt))}</p>
                </div>
                {canDelete && <button type="button" onClick={() => setPendingDelete(item)} aria-label={t('deleteAria', { name: item.filename })} className="row-span-2 flex h-10 w-10 cursor-pointer items-center justify-center self-center rounded-lg text-muted transition-colors hover:bg-danger-50 hover:text-danger-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger-600 sm:row-span-1"><Trash2 className="h-4 w-4" /></button>}
              </article>
            ))}
          </div>
        )}

        {canDelete && pendingDelete && <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><button type="button" aria-label={t('cancel')} onClick={() => !deleting && setPendingDelete(null)} className="absolute inset-0 cursor-pointer bg-black/50 backdrop-blur-sm" /><div role="dialog" aria-modal="true" aria-labelledby="delete-media-title" className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-soft-lg"><div className="flex items-start justify-between gap-3"><h2 id="delete-media-title" className="text-base font-semibold text-foreground">{t('deleteTitle')}</h2><button type="button" onClick={() => setPendingDelete(null)} aria-label={t('close')} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-background"><X className="h-4 w-4" /></button></div><p className="mt-2 text-sm text-muted">{t('deleteText', { name: pendingDelete.filename })}</p><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={deleting} onClick={() => setPendingDelete(null)} className="min-h-11 cursor-pointer rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-background disabled:opacity-60">{t('cancel')}</button><button type="button" disabled={deleting} onClick={() => void confirmDelete()} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-danger-600 px-4 text-sm font-semibold text-white hover:bg-danger-500 disabled:opacity-60">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{t('delete')}</button></div></div></div>}
      </div>
    </div>
  );
}
