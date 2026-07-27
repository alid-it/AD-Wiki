'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Eye,
  GitCompare,
  RotateCcw,
  Loader2,
  AlertCircle,
  X,
  ChevronDown,
} from 'lucide-react';
import { pages as pagesApi, ApiClientError } from '@ad-wiki/api-client';
import type { PageDetail } from '@ad-wiki/shared-types';
import { loadVersions, type CombinedVersion } from '@/lib/version-utils';
import { ArticleContent } from '@/components/content/article-content';
import { useAuth } from '@/lib/auth-context';
import { useLocaleSwitcher } from '@/lib/i18n-context';

export default function VersionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const t = useTranslations('versions');
  const tc = useTranslations('common');
  const { locale } = useLocaleSwitcher();
  const formatDateTime = (iso: string): string =>
    new Date(iso).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const [page, setPage] = useState<PageDetail | null>(null);
  const [versions, setVersions] = useState<CombinedVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<CombinedVersion | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const { page, versions } = await loadVersions(slug, signal);
        setPage(page);
        setVersions(versions);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(
            err instanceof ApiClientError && err.status === 404
              ? t('notExist')
              : t('loadFailed'),
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function confirmRestore() {
    if (!page || !restoreTarget) return;
    setRestoring(true);
    try {
      await pagesApi.update(page.id, {
        title: restoreTarget.title,
        content: restoreTarget.content,
        changeMessage: t('restoredMessage', { version: restoreTarget.version }),
      });
      setRestoreTarget(null);
      setExpanded(null);
      setLoading(true);
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('restoreFailed'));
    } finally {
      setRestoring(false);
    }
  }

  /** Ziel-Diff für „Vergleichen": gewählte Version vs. aktuelle (bzw. Vorgänger). */
  function compareHref(v: CombinedVersion): string {
    const current = versions[0]; // desc sortiert → höchste Version zuerst
    const to = v.version;
    const from = v.isCurrent
      ? (versions[1]?.version ?? v.version)
      : current.version;
    return `/wiki/${slug}/versions/diff?from=${from}&to=${to}`;
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error && versions.length === 0) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted" />
        <p className="mb-4 text-sm text-foreground">{error}</p>
        <Link
          href="/wiki"
          className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
        >
          {t('backToWiki')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      {/* Kopf */}
      <div className="mb-6">
        <Link
          href={`/wiki/${slug}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToArticle')}
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {t('history')}
            </h1>
            {page && <p className="mt-1 text-sm text-muted">{page.title}</p>}
          </div>
          {versions.length > 1 && (
            <Link
              href={`/wiki/${slug}/versions/diff`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
            >
              <GitCompare className="h-4 w-4" />
              {t('compare')}
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Liste */}
      <ol className="flex flex-col gap-3">
        {versions.map((v) => (
          <li key={v.version} className="rounded-xl border border-border bg-surface">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-semibold ${
                    v.isCurrent
                      ? 'bg-accent-600 text-white'
                      : 'bg-background text-muted'
                  }`}
                >
                  v{v.version}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {v.changeMessage || (v.isCurrent ? t('currentVersion') : t('withoutChangeMessage'))}
                    {v.isCurrent && (
                      <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700">
                        {t('current')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {v.authorName} · {formatDateTime(v.createdAt)}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded((cur) => (cur === v.version ? null : v.version))}
                  aria-expanded={expanded === v.version}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-background hover:text-foreground cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {t('show')}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${
                      expanded === v.version ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <Link
                  href={compareHref(v)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-background hover:text-foreground cursor-pointer"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  {t('compare')}
                </Link>
                {isAuthenticated && !v.isCurrent && (
                  <button
                    type="button"
                    onClick={() => setRestoreTarget(v)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent-600 transition-colors hover:bg-accent-50 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('restore')}
                  </button>
                )}
              </div>
            </div>

            {expanded === v.version && (
              <div className="border-t border-border p-4">
                {v.content.trim() ? (
                  <ArticleContent content={v.content} />
                ) : (
                  <p className="text-sm text-muted">{t('noContentVersion')}</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      {/* Wiederherstellen-Dialog */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={t('close')}
            onClick={() => !restoring && setRestoreTarget(null)}
            onKeyDown={(e) => e.key === 'Escape' && setRestoreTarget(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-soft-lg">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                {t('restoreTitle', { version: restoreTarget.version })}
              </h2>
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                aria-label={t('close')}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-background cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-5 text-sm text-muted">
              {t('restoreText', { version: restoreTarget.version })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                disabled={restoring}
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-60 cursor-pointer"
              >
                {tc('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void confirmRestore()}
                disabled={restoring}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
              >
                {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {t('restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
