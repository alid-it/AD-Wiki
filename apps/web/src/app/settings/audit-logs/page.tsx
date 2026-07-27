'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  ScrollText,
} from 'lucide-react';
import { audit as auditApi, users as usersApi, ApiClientError } from '@ad-wiki/api-client';
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCES,
  type AuditLog,
  type AdminUser,
} from '@ad-wiki/shared-types';
import {
  auditTone,
  auditSubject,
  TONE_BADGE,
  TONE_DOT,
} from '@/lib/audit-format';
import { useAuditFormat } from '@/lib/use-audit-format';
import { useAuth } from '@/lib/auth-context';

const PER_PAGE = 20;

/** Filterzustand der Audit-Log-Ansicht. */
interface Filters {
  resource: string;
  action: string;
  userId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { resource: '', action: '', userId: '', from: '', to: '' };

export default function AuditLogsPage() {
  const t = useTranslations('audit');
  const { hasPermission } = useAuth();
  const canRead = hasPermission('audit_logs', 'read');
  const canReadUsers = hasPermission('users', 'read');
  const { actionLabel, resourceLabel, relativeTime, absoluteTime } = useAuditFormat();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  // Cursor-Pagination: aktueller Cursor, Verlauf voriger Cursor (für „Zurück")
  // und der Cursor der nächsten Seite (aus der Antwort).
  const [cursor, setCursor] = useState<string | null>(null);
  const [prevCursors, setPrevCursors] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const pageIndex = prevCursors.length + 1;
  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== ''),
    [filters],
  );

  // Benutzer einmalig für das Filter-Dropdown laden.
  useEffect(() => {
    if (!canReadUsers) return;
    usersApi
      .list()
      .then(setUsers)
      .catch(() => {
        /* Filter bleibt ohne Benutzerauswahl nutzbar. */
      });
  }, [canReadUsers]);

  // Audit-Logs bei Filter-/Cursorwechsel neu laden.
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    auditApi
      .list(
        {
          resource: filters.resource || undefined,
          action: filters.action || undefined,
          userId: filters.userId || undefined,
          from: filters.from ? new Date(filters.from).toISOString() : undefined,
          // „to" inklusiv bis Ende des gewählten Tages.
          to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
          cursor: cursor ?? undefined,
          perPage: PER_PAGE,
        },
        controller.signal,
      )
      .then((res) => {
        setLogs(res.data);
        setTotal(res.meta.total);
        setNextCursor(res.meta.nextCursor);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiClientError ? err.message : t('loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canRead, cursor, filters, t]);

  if (!canRead) return null;

  /** Blättert zur nächsten Seite (aktuellen Cursor auf den Verlauf legen). */
  function goNext() {
    if (!nextCursor) return;
    setPrevCursors((stack) => [...stack, cursor]);
    setCursor(nextCursor);
  }

  /** Blättert eine Seite zurück (letzten Cursor aus dem Verlauf holen). */
  function goPrev() {
    setPrevCursors((stack) => {
      if (stack.length === 0) return stack;
      const copy = [...stack];
      const previous = copy.pop() ?? null;
      setCursor(previous);
      return copy;
    });
  }

  /** Setzt Blätter-Zustand auf die erste Seite zurück. */
  function resetPaging() {
    setCursor(null);
    setPrevCursors([]);
  }

  function updateFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    resetPaging();
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    resetPaging();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-muted" />
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
      </div>
      <p className="-mt-3 text-sm text-muted">{t('subtitle')}</p>

      {/* Filterleiste */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          <Filter className="h-3.5 w-3.5" />
          {t('filter')}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('resource')}</span>
            <select
              value={filters.resource}
              onChange={(e) => updateFilter('resource', e.target.value)}
              className="min-h-9 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent-600 focus:outline-none cursor-pointer"
            >
              <option value="">{t('all')}</option>
              {AUDIT_RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {resourceLabel(r)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('action')}</span>
            <select
              value={filters.action}
              onChange={(e) => updateFilter('action', e.target.value)}
              className="min-h-9 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent-600 focus:outline-none cursor-pointer"
            >
              <option value="">{t('all')}</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('user')}</span>
            <select
              value={filters.userId}
              onChange={(e) => updateFilter('userId', e.target.value)}
              className="min-h-9 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent-600 focus:outline-none cursor-pointer"
            >
              <option value="">{t('all')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('from')}</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => updateFilter('from', e.target.value)}
              className="min-h-9 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent-600 focus:outline-none cursor-pointer"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t('to')}</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => updateFilter('to', e.target.value)}
              className="min-h-9 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent-600 focus:outline-none cursor-pointer"
            />
          </label>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-background hover:text-foreground cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            {t('resetFilters')}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tabelle */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted" />
            <p className="text-sm font-medium text-foreground">{t('noEntries')}</p>
            <p className="max-w-xs text-sm text-muted">
              {hasActiveFilters ? t('noEntriesFilter') : t('noEntriesEmpty')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted">
                  <th className="px-4 py-3">{t('timestamp')}</th>
                  <th className="px-4 py-3">{t('user')}</th>
                  <th className="px-4 py-3">{t('action')}</th>
                  <th className="px-4 py-3">{t('resource')}</th>
                  <th className="px-4 py-3">{t('details')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const tone = auditTone(log.action);
                  const expanded = expandedId === log.id;
                  const subject = auditSubject(log);
                  const hasDetails = log.details && Object.keys(log.details).length > 0;
                  return (
                    <RowGroup key={log.id}>
                      <tr className="border-b border-border transition-colors hover:bg-background">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-foreground" title={absoluteTime(log.createdAt)}>
                            {relativeTime(log.createdAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-foreground">
                          {log.user?.displayName ?? (
                            <span className="text-muted">{t('system')}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_BADGE[tone]}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`} />
                            {actionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          {resourceLabel(log.resource)}
                        </td>
                        <td className="px-4 py-3">
                          {hasDetails ? (
                            <button
                              type="button"
                              onClick={() => setExpandedId(expanded ? null : log.id)}
                              aria-expanded={expanded}
                              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-50 cursor-pointer"
                            >
                              <span className="max-w-[220px] truncate">
                                {subject ?? t('show')}
                              </span>
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform duration-200 ${
                                  expanded ? 'rotate-180' : ''
                                }`}
                              />
                            </button>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      </tr>
                      {expanded && hasDetails && (
                        <tr className="border-b border-border bg-background">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="flex flex-col gap-2">
                              {log.ipAddress && (
                                <p className="text-xs text-muted">
                                  {t('ipAddress')}:{' '}
                                  <span className="font-mono text-foreground">
                                    {log.ipAddress}
                                  </span>
                                </p>
                              )}
                              <pre className="overflow-x-auto rounded-lg border border-border bg-surface p-3 text-xs text-foreground">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </RowGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cursor-Pagination */}
      {!loading && logs.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t('entryCount', { count: total, page: pageIndex })}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goPrev}
              disabled={prevCursors.length === 0}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50 disabled:hover:bg-transparent cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('back')}
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!nextCursor}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50 disabled:hover:bg-transparent cursor-pointer"
            >
              {t('next')}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fragment-Wrapper, damit zu jeder Zeile optional eine Detailzeile gehört,
 * ohne die Tabellenstruktur zu verletzen.
 */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
