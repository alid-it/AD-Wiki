'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Image as ImageIcon, Loader2, Search, Upload, X } from 'lucide-react';
import { media, ApiClientError } from '@ad-wiki/api-client';
import type { Media } from '@ad-wiki/shared-types';
import { mediaUrl } from '@/lib/content';
import { AuthenticatedMediaImage } from '@/components/content/authenticated-media-image';

interface MediaPickerModalProps {
  pageId?: string;
  onClose: () => void;
  onSelect: (item: Media, url: string) => void;
}

/** Gemeinsame Bildauswahl fuer Markdown- und WYSIWYG-Editor. */
export function MediaPickerModal({ pageId, onClose, onSelect }: MediaPickerModalProps) {
  const t = useTranslations('editor.mediaPicker');
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'existing' | 'upload'>('existing');
  const [items, setItems] = useState<Media[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    media.list({ page: 1, limit: 100, scope: 'mine' }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setItems(result.data.filter((item) => item.mimetype.startsWith('image/')));
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setError(reason instanceof ApiClientError ? reason.message : t('loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && !uploading && onClose();
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, uploading]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? items.filter((item) => item.filename.toLocaleLowerCase().includes(needle)) : items;
  }, [items, query]);

  async function choose(item: Media) {
    setError(null);
    try {
      let selected = item;
      if (pageId && !item.pageIds.includes(pageId)) {
        selected = await media.setPages(item.id, { pageIds: [...item.pageIds, pageId] });
      }
      onSelect(selected, mediaUrl(selected.id));
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('selectFailed'));
    }
  }

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(jpe?g|png|gif|webp)$/i.test(file.name)) {
      setError(t('imagesOnly'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      let uploaded = await media.upload(file);
      if (pageId) uploaded = await media.setPages(uploaded.id, { pageIds: [pageId] });
      onSelect(uploaded, mediaUrl(uploaded.id));
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('uploadFailed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void uploadFile(event.dataTransfer.files?.[0]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button type="button" aria-label={t('close')} onClick={onClose} className="absolute inset-0 cursor-pointer bg-black/50 backdrop-blur-sm" />
      <section role="dialog" aria-modal="true" aria-labelledby="media-picker-title" className="relative flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div>
            <h2 id="media-picker-title" className="text-lg font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex gap-1 border-b border-border px-4 pt-2 sm:px-6" role="tablist">
          {(['existing', 'upload'] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-11 cursor-pointer border-b-2 px-3 text-sm font-medium transition-colors ${tab === key ? 'border-accent-600 text-accent-700' : 'border-transparent text-muted hover:text-foreground'}`}>{t(key)}</button>
          ))}
        </div>

        {error && <div role="alert" className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2 text-sm text-danger-600 sm:mx-6"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {tab === 'existing' ? (
            <>
              <label className="relative mb-4 block">
                <span className="sr-only">{t('search')}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} className="min-h-11 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20" />
              </label>
              {loading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : filtered.length === 0 ? <div className="py-14 text-center"><ImageIcon className="mx-auto h-8 w-8 text-muted" /><p className="mt-3 text-sm text-muted">{t(query ? 'noResults' : 'empty')}</p></div> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {filtered.map((item) => <button key={item.id} type="button" onClick={() => void choose(item)} className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-background text-left transition-colors hover:border-accent-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"><AuthenticatedMediaImage mediaId={item.id} alt={item.altText ?? item.filename} className="aspect-square h-auto w-full object-cover" loading="lazy" /><span className="block truncate px-2.5 py-2 text-xs font-medium text-foreground" title={item.filename}>{item.filename}</span></button>)}
                </div>
              )}
            </>
          ) : (
            <div onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={handleDrop} className={`flex min-h-72 flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragActive ? 'border-accent-600 bg-accent-50' : 'border-border bg-background'}`}>
              {uploading ? <Loader2 className="h-9 w-9 animate-spin text-accent-600" /> : <Upload className="h-9 w-9 text-accent-600" />}
              <p className="mt-4 text-sm font-semibold text-foreground">{uploading ? t('uploading') : t('dropTitle')}</p>
              <p className="mt-1 text-xs text-muted">{t('dropHint')}</p>
              <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="mt-5 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"><Upload className="h-4 w-4" />{t('chooseFile')}</button>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={(event) => void uploadFile(event.target.files?.[0])} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
