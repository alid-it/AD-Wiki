'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, KeyRound, Loader2, Search } from 'lucide-react';
import { apiKeys as apiKeysApi, ApiClientError } from '@ad-wiki/api-client';
import type { AdminApiKey, ApiKeyStatus } from '@ad-wiki/shared-types';

export default function AdminApiKeysPage() {
  const t = useTranslations('settings.apiKeys');
  const locale = useLocale();
  const [keys, setKeys] = useState<AdminApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    apiKeysApi.listAll(controller.signal)
      .then(setKeys)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof ApiClientError ? cause.message : t('loadFailed'));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [t]);

  const visibleKeys = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return keys;
    return keys.filter((key) => [key.name, key.user.displayName, key.user.username, key.user.email]
      .some((value) => value.toLocaleLowerCase(locale).includes(normalized)));
  }, [keys, locale, query]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('description')}</p>
          </div>
        </div>
        <label className="relative mt-4 block">
          <span className="sr-only">{t('search')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20" />
        </label>
      </div>

      {error && <div role="alert" className="m-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 sm:m-5"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
      {loading ? (
        <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : visibleKeys.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <KeyRound className="mx-auto h-7 w-7 text-muted" />
          <p className="mt-2 text-sm font-medium text-foreground">{query ? t('noResults') : t('empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-background text-xs font-semibold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3">{t('name')}</th>
                <th className="px-5 py-3">{t('user')}</th>
                <th className="px-5 py-3">{t('created')}</th>
                <th className="px-5 py-3">{t('lastUsed')}</th>
                <th className="px-5 py-3">{t('expires')}</th>
                <th className="px-5 py-3">{t('statusLabel')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleKeys.map((key) => (
                <tr key={key.id} className="transition-colors hover:bg-background/70">
                  <td className="px-5 py-4 font-medium text-foreground">{key.name}</td>
                  <td className="px-5 py-4">
                    <p className="font-medium text-foreground">{key.user.displayName}</p>
                    <p className="text-xs text-muted">@{key.user.username} · {key.user.email}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-muted">{formatDate(key.createdAt, locale)}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-muted">{key.lastUsedAt ? formatDate(key.lastUsedAt, locale) : t('never')}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-muted">{key.expiresAt ? formatDate(key.expiresAt, locale) : t('unlimited')}</td>
                  <td className="px-5 py-4"><StatusBadge status={key.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const t = useTranslations('settings.apiKeys.status');
  const classes = status === 'active'
    ? 'bg-success-50 text-success-600'
    : status === 'expired'
      ? 'bg-warning-50 text-warning-700'
      : 'bg-background text-muted';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>{t(status)}</span>;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
