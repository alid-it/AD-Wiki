'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Loader2, Search, SearchX } from 'lucide-react';
import { search as searchApi } from '@ad-wiki/api-client';
import type { GlobalSearchFilterType, GlobalSearchResult } from '@ad-wiki/shared-types';
import { SearchResultItem } from '@/components/search/search-result-item';
import { useAuth } from '@/lib/auth-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

const PER_PAGE = 15;

const TABS: Array<{ key: 'all' | GlobalSearchFilterType; types?: GlobalSearchFilterType[] }> = [
  { key: 'all' },
  { key: 'pages', types: ['pages'] },
  { key: 'notes', types: ['notes'] },
  { key: 'standards', types: ['standards'] },
  { key: 'media', types: ['media'] },
];

function parseTypes(value: string | null): GlobalSearchFilterType[] | undefined {
  if (!value) return undefined;
  const allowed = new Set<GlobalSearchFilterType>(['pages', 'notes', 'standards', 'media']);
  const types = value.split(',').filter((type): type is GlobalSearchFilterType => allowed.has(type as GlobalSearchFilterType));
  return types.length ? types : undefined;
}

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('search');
  const { hasPermission } = useAuth();
  const q = params.get('q') ?? '';
  const typesParam = params.get('types');
  const types = parseTypes(typesParam);
  const readableTypes = useMemo(
    () =>
      (['pages', 'notes', 'standards', 'media'] as GlobalSearchFilterType[]).filter(
        (type) => hasPermission(type, 'read'),
      ),
    [hasPermission],
  );
  const readableSignature = readableTypes.join(',');
  const selectedReadableTypes = types?.filter((type) => readableTypes.includes(type));
  const requestTypes =
    types && selectedReadableTypes && selectedReadableTypes.length > 0
      ? selectedReadableTypes
      : undefined;
  const visibleTabs = TABS.filter(
    (tab) => !tab.types || tab.types.some((type) => readableTypes.includes(type)),
  );

  const [input, setInput] = useState(q);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aclRevision, setAclRevision] = useState(0);

  useEffect(() => {
    setInput(q);
    setPage(1);
  }, [q, typesParam]);

  useEffect(() => {
    const refreshForAclChange = () => setAclRevision((revision) => revision + 1);
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, refreshForAclChange);
    return () =>
      window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, refreshForAclChange);
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    searchApi
      .globalSearch(q, { types: requestTypes, page, limit: PER_PAGE }, controller.signal)
      .then((response) => {
        setResults(response.data);
        setTotal(response.meta.total);
      })
      .catch((requestError) => {
        if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
          setError(t('unavailable'));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [aclRevision, q, typesParam, page, readableSignature]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    const trimmed = input.trim();
    if (trimmed) next.set('q', trimmed);
    if (typesParam) next.set('types', typesParam);
    router.push(next.size ? `/search?${next}` : '/search');
  }

  function selectTab(tabTypes?: GlobalSearchFilterType[]) {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (tabTypes) next.set('types', tabTypes.join(','));
    router.push(`/search${next.size ? `?${next}` : ''}`);
  }

  const activeTab = visibleTabs.find(
    (tab) => (tab.types?.join(',') ?? null) === typesParam,
  )?.key ?? 'all';
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <form onSubmit={submitSearch} className="relative mb-5">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="w-full rounded-xl border border-border bg-surface py-3.5 pl-12 pr-4 text-base text-foreground shadow-soft-sm transition-colors placeholder:text-muted focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
          autoFocus
        />
      </form>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label={t('filterLabel')}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => selectTab(tab.types)}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors ${activeTab === tab.key ? 'border-accent-600 text-accent-700 dark:text-accent-300' : 'border-transparent text-muted hover:border-border-strong hover:text-foreground'}`}
          >
            {t(`tab${tab.key[0].toUpperCase()}${tab.key.slice(1)}` as 'tabAll')}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20" aria-label={t('searching')}>
          <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
        </div>
      )}

      {!loading && error && <p className="py-12 text-center text-sm text-danger-600">{error}</p>}

      {!loading && !error && q.trim() && results.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
          <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-background text-muted"><SearchX className="h-6 w-6" /></span>
          <p className="text-sm font-medium text-foreground">{t('noResults')}</p>
          <p className="max-w-md text-sm text-muted">{t('noResultsHint', { query: q })}</p>
        </div>
      )}

      {!loading && !error && !q.trim() && (
        <p className="py-20 text-center text-sm text-muted">{t('enterQuery')}</p>
      )}

      {!loading && !error && results.length > 0 && (
        <>
          <p className="mb-3 text-xs text-muted">{t('resultsFor', { count: total, query: q })}</p>
          <ul className="flex flex-col gap-3">
            {results.map((result) => <li key={`${result.type}-${result.id}`}><SearchResultItem result={result} /></li>)}
          </ul>

          {totalPages > 1 && (
            <nav className="mt-7 flex items-center justify-center gap-3" aria-label={t('pagination')}>
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />{t('back')}
              </button>
              <span className="text-sm text-muted">{t('pageOf', { page, total: totalPages })}</span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('next')}<ChevronRight className="h-4 w-4" />
              </button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}>
      <SearchView />
    </Suspense>
  );
}
