'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { search as searchApi } from '@ad-wiki/api-client';
import type { GlobalSearchResult } from '@ad-wiki/shared-types';
import { SearchResultItem } from '@/components/search/search-result-item';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations('search');
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [accessRevision, setAccessRevision] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      searchApi
        .globalSearch(query.trim(), { limit: 8 }, controller.signal)
        .then((response) => {
          setResults(response.data);
          setActiveIndex(0);
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) setResults([]);
        })
        .finally(() => setLoading(false));
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accessRevision, open, query]);

  useEffect(() => {
    const refreshForAccessChange = () => setAccessRevision((value) => value + 1);
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, refreshForAccessChange);
    return () => window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, refreshForAccessChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  function openResult(result: GlobalSearchResult) {
    onClose();
    router.push(result.url);
  }

  function openAll() {
    const trimmed = query.trim();
    if (!trimmed) return;
    onClose();
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/45 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-search-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <h2 id="command-search-title" className="sr-only">{t('paletteTitle')}</h2>
        <div className="flex items-center gap-3 border-b border-border px-4">
          {loading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent-600" /> : <Search className="h-5 w-5 shrink-0 text-muted" />}
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault();
                setActiveIndex((current) => (current + 1) % results.length);
              } else if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault();
                setActiveIndex((current) => (current - 1 + results.length) % results.length);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const result = results[activeIndex];
                if (result) openResult(result);
                else openAll();
              }
            }}
            placeholder={t('palettePlaceholder')}
            aria-label={t('palettePlaceholder')}
            aria-activedescendant={results[activeIndex] ? `command-result-${activeIndex}` : undefined}
            className="min-h-14 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted"
          />
          <button type="button" onClick={onClose} aria-label={t('close')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-foreground sm:hidden">
            <X className="h-4 w-4" />
          </button>
          <kbd className="hidden rounded border border-border bg-background px-1.5 py-1 text-[10px] text-muted sm:inline">ESC</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {query.trim().length < 2 && <p className="px-3 py-10 text-center text-sm text-muted">{t('paletteHint')}</p>}
          {query.trim().length >= 2 && !loading && results.length === 0 && <p className="px-3 py-10 text-center text-sm text-muted">{t('noResults')}</p>}
          {results.length > 0 && (
            <ul role="listbox" aria-label={t('results')}>
              {results.map((result, index) => (
                <li key={`${result.type}-${result.id}`} id={`command-result-${index}`} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)}>
                  <SearchResultItem result={result} compact active={index === activeIndex} onOpen={onClose} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-background/70 px-4 py-2 text-[11px] text-muted">
          <button type="button" onClick={openAll} disabled={!query.trim()} className="font-medium text-accent-700 hover:text-accent-800 disabled:opacity-40 dark:text-accent-300">
            {t('showAll')}
          </button>
          <span className="hidden items-center gap-3 sm:flex">
            <span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> {t('navigate')}</span>
            <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> {t('open')}</span>
          </span>
        </footer>
      </section>
    </div>
  );
}
