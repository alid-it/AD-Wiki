'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Unplug,
  BookOpen,
} from 'lucide-react';
import { ApiClientError, integrations } from '@ad-wiki/api-client';
import type { IntegrationSyncRun, MicrosoftConnection, MicrosoftTodoList } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';

export default function IntegrationsSettingsPage() {
  const t = useTranslations('settings.integrations');
  const { hasPermission } = useAuth();
  const canConnect = hasPermission('integrations', 'create');
  const canUpdate = hasPermission('integrations', 'update');
  const canDisconnect = hasPermission('integrations', 'delete');
  const [connection, setConnection] = useState<MicrosoftConnection | null>(null);
  const [lists, setLists] = useState<MicrosoftTodoList[]>([]);
  const [runs, setRuns] = useState<IntegrationSyncRun[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await integrations.status();
      setConnection(status);
      if (status.connected) {
        const [availableLists, syncRuns] = await Promise.all([integrations.lists(), integrations.syncRuns()]);
        setLists(availableLists);
        setSelected(availableLists.filter((list) => list.selected).map((list) => list.id));
        setRuns(syncRuns);
      } else {
        setLists([]);
        setSelected([]);
        setRuns(await integrations.syncRuns());
      }
    } catch (err) {
      setError(message(err, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('microsoft');
    if (result === 'connected') setNotice(t('connectedNotice'));
    if (result === 'denied') setError(t('deniedNotice'));
    if (result === 'error') setError(t('oauthFailed'));
    if (result) window.history.replaceState({}, '', window.location.pathname);
    void load();
  }, [load, t]);

  async function connect() {
    setBusy('connect'); setError(null);
    try {
      const result = await integrations.startMicrosoftOAuth();
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(message(err, t('oauthFailed'))); setBusy(null);
    }
  }

  async function saveSelection() {
    setBusy('save'); setError(null); setNotice(null);
    try {
      const status = await integrations.selectLists({ listIds: selected });
      setConnection(status); setLists((current) => current.map((list) => ({ ...list, selected: selected.includes(list.id) })));
      setNotice(t('selectionSaved'));
    } catch (err) { setError(message(err, t('saveFailed'))); }
    finally { setBusy(null); }
  }

  async function synchronize() {
    setBusy('sync'); setError(null); setNotice(null);
    try {
      const run = await integrations.sync();
      setRuns((current) => [run, ...current].slice(0, 20));
      setConnection(await integrations.status());
      setNotice(t('syncDone', { imported: run.importedCount, skipped: run.skippedCount }));
    } catch (err) { setError(message(err, t('syncFailed'))); setRuns(await integrations.syncRuns().catch(() => runs)); }
    finally { setBusy(null); }
  }

  async function disconnect() {
    if (!window.confirm(t('disconnectConfirm'))) return;
    setBusy('disconnect'); setError(null); setNotice(null);
    try {
      setConnection(await integrations.disconnect()); setLists([]); setSelected([]); setNotice(t('disconnectedNotice'));
    } catch (err) { setError(message(err, t('disconnectFailed'))); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  const connected = connection?.connected === true;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2><p className="mt-1 text-sm text-muted">{t('description')}</p></div>
        <Link href="/settings/setup#integrations" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background">
          <BookOpen className="h-4 w-4" />
          {t('openGuide')}
        </Link>
      </div>
      {error && <Banner danger icon={AlertCircle}>{error}</Banner>}
      {notice && <Banner icon={CheckCircle2}>{notice}</Banner>}

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Plug className="h-5 w-5" /></div><div><h3 className="font-semibold text-foreground">Microsoft To Do</h3><p className="mt-1 text-sm text-muted">{connected ? t('connectedAs', { account: connection.accountName ?? t('unknownAccount') }) : t('notConnected')}</p><span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${connection?.status === 'active' ? 'bg-success-50 text-success-600' : connection?.status === 'needs_reauth' ? 'bg-warning-50 text-warning-700' : 'bg-background text-muted'}`}>{t(`status_${connection?.status ?? 'disconnected'}`)}</span></div></div>
          <div className="flex flex-wrap gap-2">
            {canConnect && (!connected || connection?.status === 'needs_reauth') && <button type="button" onClick={() => void connect()} disabled={busy !== null || !connection?.configured} className={primary}><ExternalLink className="h-4 w-4" />{busy === 'connect' ? t('connecting') : connected ? t('reconnect') : t('connect')}</button>}
            {canDisconnect && connected && <button type="button" onClick={() => void disconnect()} disabled={busy !== null} className={dangerButton}>{busy === 'disconnect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}{t('disconnect')}</button>}
          </div>
        </div>
        {!connection?.configured && <p className="mt-4 rounded-lg bg-warning-50 p-3 text-sm text-warning-700">{t('notConfigured')}</p>}
        <p className="mt-4 text-xs leading-5 text-muted">{t('securityHint')}</p>
      </section>

      {connected && connection.status === 'active' && <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-brand-600" /><h3 className="font-semibold text-foreground">{t('listsTitle')}</h3></div>
        <p className="mt-1 text-sm text-muted">{t('listsHint')}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">{lists.map((list) => <label key={list.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><input type="checkbox" checked={selected.includes(list.id)} disabled={!canUpdate || busy !== null} onChange={(event) => setSelected((current) => event.target.checked ? [...current, list.id] : current.filter((id) => id !== list.id))} className="h-4 w-4 accent-accent-600" /><span className="min-w-0 truncate">{list.displayName}</span></label>)}</div>
        {!lists.length && <p className="mt-4 text-sm text-muted">{t('noLists')}</p>}
        {canUpdate && <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void saveSelection()} disabled={busy !== null} className={secondary}><Save className="h-4 w-4" />{busy === 'save' ? t('saving') : t('saveSelection')}</button><button type="button" onClick={() => void synchronize()} disabled={busy !== null || connection.selectedListIds.length === 0} className={primary}>{busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy === 'sync' ? t('syncing') : t('syncNow')}</button></div>}
      </section>}

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-brand-600" /><h3 className="font-semibold text-foreground">{t('historyTitle')}</h3></div>
        <div className="mt-4 divide-y divide-border">{runs.map((run) => <div key={run.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-foreground">{t(`run_${run.status}`)}</p><p className="text-xs text-muted">{new Date(run.startedAt).toLocaleString()}</p></div><p className="text-xs text-muted">{t('runCounts', { imported: run.importedCount, updated: run.updatedCount, deleted: run.deletedCount, skipped: run.skippedCount, failed: run.failedCount })}</p></div>)}</div>
        {!runs.length && <p className="mt-4 text-sm text-muted">{t('noHistory')}</p>}
      </section>
    </div>
  );
}

const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer';
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer';
const dangerButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-danger-500/40 px-4 py-2 text-sm font-semibold text-danger-600 hover:bg-danger-50 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer';

function Banner({ children, danger = false, icon: Icon }: { children: ReactNode; danger?: boolean; icon: typeof AlertCircle }) {
  return <div role={danger ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${danger ? 'border-danger-500/30 bg-danger-50 text-danger-600' : 'border-success-500/30 bg-success-50 text-success-600'}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></div>;
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
