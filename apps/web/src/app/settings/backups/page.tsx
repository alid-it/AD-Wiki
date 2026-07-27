'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  Archive,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clipboard,
  Clock3,
  Cloud,
  DatabaseBackup,
  Download,
  FileDown,
  HardDrive,
  KeyRound,
  Loader2,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { ApiClientError, backups as backupApi } from '@ad-wiki/api-client';
import {
  CreateBackupDestinationSchema,
  type BackupDestinationType,
  type BackupDestination,
  type BackupJob,
  type BackupOverview,
  type BackupPlan,
  type RestoreRunbook,
  type CreateBackupPlanInput,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const DEFAULT_DRAFT: PlanDraft = {
  name: '',
  enabled: true,
  destinationId: '',
  time: '02:00',
  timezone: 'Europe/Berlin',
  weekdays: [...WEEKDAYS],
  daily: 7,
  weekly: 4,
  monthly: 6,
};

const DEFAULT_DESTINATION_DRAFT: DestinationDraft = {
  name: '',
  type: 'local',
  mountName: 'local',
  subdirectory: '',
  host: '',
  port: 22,
  username: '',
  basePath: '/backups/ad-wiki',
  hostKeyFingerprint: '',
  sftpAuthentication: 'privateKey',
  password: '',
  privateKey: '',
  passphrase: '',
  endpoint: 'https://',
  region: 'eu-central-1',
  bucket: '',
  prefix: 'ad-wiki',
  forcePathStyle: false,
  serverSideEncryption: 'AES256',
  kmsKeyId: '',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
};

interface DestinationDraft {
  name: string;
  type: BackupDestinationType;
  mountName: string;
  subdirectory: string;
  host: string;
  port: number;
  username: string;
  basePath: string;
  hostKeyFingerprint: string;
  sftpAuthentication: 'password' | 'privateKey';
  password: string;
  privateKey: string;
  passphrase: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  serverSideEncryption: 'AES256' | 'aws:kms';
  kmsKeyId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

interface PlanDraft {
  name: string;
  enabled: boolean;
  destinationId: string;
  time: string;
  timezone: string;
  weekdays: number[];
  daily: number;
  weekly: number;
  monthly: number;
}

export default function BackupSettingsPage() {
  const t = useTranslations('settings.backups');
  const locale = useLocale();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('backups', 'create');
  const canUpdate = hasPermission('backups', 'update');
  const canDelete = hasPermission('backups', 'delete');
  const canRun = hasPermission('backups', 'run');
  const canRestore = hasPermission('backups', 'restore');
  const [destinations, setDestinations] = useState<BackupDestination[]>([]);
  const [plans, setPlans] = useState<BackupPlan[]>([]);
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [overview, setOverview] = useState<BackupOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runbook, setRunbook] = useState<RestoreRunbook | null>(null);
  const [restoreAcknowledged, setRestoreAcknowledged] = useState(false);
  const [showDestinationForm, setShowDestinationForm] = useState(false);
  const [destinationDraft, setDestinationDraft] = useState<DestinationDraft>(() => ({
    ...DEFAULT_DESTINATION_DRAFT,
    name: t('defaultDestinationName'),
  }));
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(() => ({
    ...DEFAULT_DRAFT,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_DRAFT.timezone,
  }));

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const [nextDestinations, nextPlans, nextJobs, nextOverview] = await Promise.all([
        backupApi.listDestinations(),
        backupApi.listPlans(),
        backupApi.listJobs(),
        backupApi.overview(),
      ]);
      setDestinations(nextDestinations);
      setPlans(nextPlans);
      setJobs(nextJobs);
      setOverview(nextOverview);
      setDraft((current) => ({
        ...current,
        destinationId: current.destinationId || nextDestinations.find(isDestinationEligible)?.id || '',
      }));
      setError(null);
    } catch (cause) {
      if (initial) setError(errorMessage(cause, t('loadFailed')));
    } finally {
      if (initial) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const timezones = useMemo(() => commonTimezones(draft.timezone), [draft.timezone]);

  async function createDestination(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CreateBackupDestinationSchema.safeParse(destinationInput(destinationDraft));
    if (!parsed.success) {
      setError(t('saveFailed'));
      return;
    }
    setBusy('destination-create'); setError(null); setNotice(null);
    try {
      const created = await backupApi.createDestination(parsed.data);
      setDestinations((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      if (isDestinationEligible(created)) setDraft((current) => ({ ...current, destinationId: created.id }));
      setShowDestinationForm(false);
      setDestinationDraft({ ...DEFAULT_DESTINATION_DRAFT, name: t('defaultDestinationName') });
      setNotice(t('destinationCreated'));
    } catch (cause) {
      setError(errorMessage(cause, t('saveFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function testDestination(destination: BackupDestination) {
    setBusy(`destination-test-${destination.id}`); setError(null); setNotice(null);
    try {
      await backupApi.testDestination(destination.id);
      setNotice(t('testQueued'));
      await refreshOperationalData();
    } catch (cause) {
      setError(errorMessage(cause, t('testFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function prepareRestore(job: BackupJob) {
    setBusy(`restore-${job.id}`); setError(null); setNotice(null);
    try {
      await backupApi.prepareRestore(job.id);
      setNotice(t('restoreQueued'));
      await refreshOperationalData();
    } catch (cause) {
      setError(errorMessage(cause, t('restoreFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function openRestoreAssistant(preflightJob: BackupJob) {
    setBusy(`runbook-${preflightJob.id}`); setError(null); setNotice(null);
    try {
      setRunbook(await backupApi.getRestoreRunbook(preflightJob.id));
      setRestoreAcknowledged(false);
      document.getElementById('restore-assistant')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) {
      setError(errorMessage(cause, t('runbookFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function copyCommand(command: string) {
    await navigator.clipboard.writeText(command);
    setNotice(t('commandCopied'));
  }

  function downloadRunbook() {
    if (!runbook) return;
    const markdown = restoreRunbookMarkdown(runbook);
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ad-wiki-restore-${runbook.backupId}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function removeDestination(destination: BackupDestination) {
    if (!window.confirm(t('deleteDestinationConfirm', { name: destination.name }))) return;
    setBusy(`destination-delete-${destination.id}`); setError(null); setNotice(null);
    try {
      await backupApi.deleteDestination(destination.id);
      setDestinations((current) => current.filter((item) => item.id !== destination.id));
      setNotice(t('destinationDeleted'));
    } catch (cause) {
      setError(errorMessage(cause, t('deleteFailed')));
    } finally {
      setBusy(null);
    }
  }

  function editPlan(plan: BackupPlan) {
    setEditingPlanId(plan.id);
    setDraft({
      name: plan.name,
      enabled: plan.enabled,
      destinationId: plan.destination.id,
      time: `${String(plan.schedule.hour).padStart(2, '0')}:${String(plan.schedule.minute).padStart(2, '0')}`,
      timezone: plan.schedule.timezone,
      weekdays: [...plan.schedule.weekdays],
      daily: plan.retention.daily,
      weekly: plan.retention.weekly,
      monthly: plan.retention.monthly,
    });
    document.getElementById('backup-plan-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetPlanEditor() {
    setEditingPlanId(null);
    setDraft({
      ...DEFAULT_DRAFT,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_DRAFT.timezone,
      destinationId: destinations.find(isDestinationEligible)?.id || '',
    });
  }

  async function savePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.destinationId || draft.weekdays.length === 0) {
      setError(t('planIncomplete'));
      return;
    }
    const [hour, minute] = draft.time.split(':').map(Number);
    const input: CreateBackupPlanInput = {
      name: draft.name,
      enabled: draft.enabled,
      destinationId: draft.destinationId,
      schedule: { hour, minute, timezone: draft.timezone, weekdays: draft.weekdays },
      retention: { daily: draft.daily, weekly: draft.weekly, monthly: draft.monthly },
    };
    setBusy('plan-save'); setError(null); setNotice(null);
    try {
      if (editingPlanId) await backupApi.updatePlan(editingPlanId, input);
      else await backupApi.createPlan(input);
      await load(false);
      setNotice(t(editingPlanId ? 'planUpdated' : 'planCreated'));
      resetPlanEditor();
    } catch (cause) {
      setError(errorMessage(cause, t('saveFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function togglePlan(plan: BackupPlan) {
    setBusy(`plan-toggle-${plan.id}`); setError(null);
    try {
      const updated = await backupApi.updatePlan(plan.id, { enabled: !plan.enabled });
      setPlans((current) => current.map((item) => item.id === updated.id ? updated : item));
      await refreshOperationalData();
    } catch (cause) {
      setError(errorMessage(cause, t('saveFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function removePlan(plan: BackupPlan) {
    if (!window.confirm(t('deletePlanConfirm', { name: plan.name }))) return;
    setBusy(`plan-delete-${plan.id}`); setError(null); setNotice(null);
    try {
      await backupApi.deletePlan(plan.id);
      setPlans((current) => current.filter((item) => item.id !== plan.id));
      setNotice(t('planDeleted'));
      if (editingPlanId === plan.id) resetPlanEditor();
      await refreshOperationalData();
    } catch (cause) {
      setError(errorMessage(cause, t('deleteFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function runNow(plan: BackupPlan) {
    setBusy(`run-${plan.id}`); setError(null); setNotice(null);
    try {
      await backupApi.startBackup({ planId: plan.id });
      setNotice(t('backupQueued'));
      await refreshOperationalData();
    } catch (cause) {
      setError(errorMessage(cause, t('runFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function refreshOperationalData() {
    const [nextJobs, nextOverview] = await Promise.all([backupApi.listJobs(), backupApi.overview()]);
    setJobs(nextJobs);
    setOverview(nextOverview);
  }

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/settings/setup#backups" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2">
            <BookOpen className="h-4 w-4" />{t('openGuide')}
          </Link>
          {canRun && plans.length === 1 && (
            <button type="button" onClick={() => void runNow(plans[0])} disabled={busy !== null} className={primaryButton}>
              {busy === `run-${plans[0].id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t('runNow')}
            </button>
          )}
        </div>
      </header>

      {error && <Banner danger icon={AlertCircle}>{error}</Banner>}
      {notice && <Banner icon={CheckCircle2}>{notice}</Banner>}
      {overview?.status === 'warning' && overview.latestFailedJob && (
        <Banner danger icon={AlertCircle}>
          {t('latestFailure', { message: overview.latestFailedJob.errorMessage ?? overview.latestFailedJob.errorCode ?? t('unknownError') })}
        </Banner>
      )}

      <section aria-labelledby="backup-status-title">
        <h3 id="backup-status-title" className="sr-only">{t('statusTitle')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={ShieldCheck} label={t('health')} value={t(`healthStatus.${overview?.status ?? 'never'}`)} tone={overview?.status === 'warning' ? 'danger' : overview?.status === 'healthy' ? 'success' : 'accent'} />
          <MetricCard icon={CalendarClock} label={t('nextRun')} value={overview?.nextRunAt ? formatDate(overview.nextRunAt, locale) : t('notScheduled')} />
          <MetricCard icon={Clock3} label={t('lastSuccess')} value={overview?.lastSuccessfulJob?.finishedAt ? formatDate(overview.lastSuccessfulJob.finishedAt, locale) : t('never')} />
          <MetricCard icon={Archive} label={t('availableBackups')} value={String(overview?.availableArtifacts ?? 0)} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><HardDrive className="h-5 w-5" /></span>
            <div><h3 className="font-semibold text-foreground">{t('destinationsTitle')}</h3><p className="mt-1 text-sm text-muted">{t('destinationsDescription')}</p></div>
          </div>
          {canCreate && <button type="button" onClick={() => setShowDestinationForm((value) => !value)} className={secondaryButton}>{showDestinationForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showDestinationForm ? t('cancel') : t('addDestination')}</button>}
        </div>

        {showDestinationForm && (
          <form onSubmit={(event) => void createDestination(event)} className="mt-4 grid gap-4 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
            <DestinationFormFields draft={destinationDraft} onChange={setDestinationDraft} />
            <div className="sm:col-span-2"><button type="submit" disabled={busy !== null} className={primaryButton}>{busy === 'destination-create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('saveDestination')}</button></div>
          </form>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {destinations.map((destination) => (
            <div key={destination.id} className="flex min-h-24 items-start justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
              <div className="flex min-w-0 gap-3"><DestinationIcon type={destination.type} /><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{destination.name}</p><p className="mt-1 text-xs text-muted">{t(`destinationType.${destination.type}`)} · {destination.isEnabled ? t('active') : t('inactive')}</p><DestinationTestStatus destination={destination} locale={locale} /></div></div>
              <div className="flex shrink-0 gap-1">
                {canUpdate && <button type="button" onClick={() => void testDestination(destination)} disabled={busy !== null} aria-label={t('testConnectionFor', { name: destination.name })} title={t('testConnection')} className={iconButton}>{busy === `destination-test-${destination.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}</button>}
                {canDelete && <button type="button" onClick={() => void removeDestination(destination)} disabled={busy !== null} aria-label={t('deleteDestination', { name: destination.name })} title={t('deleteDestination', { name: destination.name })} className={iconDangerButton}>{busy === `destination-delete-${destination.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}
              </div>
            </div>
          ))}
          {destinations.length === 0 && <p className="sm:col-span-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{t('noDestinations')}</p>}
        </div>
      </section>

      {(canCreate || canUpdate) && destinations.length > 0 && (
        <section id="backup-plan-editor" className="scroll-mt-24 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700"><CalendarClock className="h-5 w-5" /></span>
            <div><h3 className="font-semibold text-foreground">{editingPlanId ? t('editPlanTitle') : t('newPlanTitle')}</h3><p className="mt-1 text-sm text-muted">{t('scheduleDescription')}</p></div>
          </div>
          <form onSubmit={(event) => void savePlan(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
            <TextField label={t('planName')} value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} required />
            <SelectField label={t('destination')} value={draft.destinationId} onChange={(destinationId) => setDraft((current) => ({ ...current, destinationId }))}>
              <option value="" disabled>{t('selectDestination')}</option>
              {destinations.filter((item) => item.isEnabled).map((destination) => <option key={destination.id} value={destination.id} disabled={isRemoteType(destination.type) && destination.lastTestSucceeded !== true}>{destination.name}{isRemoteType(destination.type) && destination.lastTestSucceeded !== true ? ` — ${t('testRequired')}` : ''}</option>)}
            </SelectField>
            <TextField label={t('time')} value={draft.time} onChange={(time) => setDraft((current) => ({ ...current, time }))} type="time" required />
            <SelectField label={t('timezone')} value={draft.timezone} onChange={(timezone) => setDraft((current) => ({ ...current, timezone }))}>
              {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
            </SelectField>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-foreground">{t('weekdays')}</legend>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                {WEEKDAYS.map((weekday) => {
                  const checked = draft.weekdays.includes(weekday);
                  return <label key={weekday} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-600/40 ${checked ? 'border-accent-600 bg-accent-50 text-accent-700' : 'border-border bg-background text-muted hover:text-foreground'}`}><input className="sr-only" type="checkbox" checked={checked} onChange={() => setDraft((current) => ({ ...current, weekdays: checked ? current.weekdays.filter((value) => value !== weekday) : [...current.weekdays, weekday].sort() }))} /><span>{t(`weekday.${weekday}`)}</span></label>;
                })}
              </div>
            </fieldset>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium text-foreground">{t('retention')}</legend>
              <p className="mt-1 text-xs leading-5 text-muted">{t('retentionHint')}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <NumberField label={t('daily')} value={draft.daily} max={365} onChange={(daily) => setDraft((current) => ({ ...current, daily }))} />
                <NumberField label={t('weekly')} value={draft.weekly} max={104} onChange={(weekly) => setDraft((current) => ({ ...current, weekly }))} />
                <NumberField label={t('monthly')} value={draft.monthly} max={120} onChange={(monthly) => setDraft((current) => ({ ...current, monthly }))} />
              </div>
            </fieldset>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground sm:col-span-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-accent-600" /><span><span className="font-medium">{t('enabled')}</span><span className="ml-1 text-muted">{t('enabledHint')}</span></span></label>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><button type="submit" disabled={busy !== null} className={primaryButton}>{busy === 'plan-save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{editingPlanId ? t('updatePlan') : t('createPlan')}</button>{editingPlanId && <button type="button" onClick={resetPlanEditor} className={secondaryButton}><X className="h-4 w-4" />{t('cancel')}</button>}</div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-center gap-3"><DatabaseBackup className="h-5 w-5 text-brand-600" /><div><h3 className="font-semibold text-foreground">{t('plansTitle')}</h3><p className="mt-1 text-sm text-muted">{t('plansDescription')}</p></div></div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-foreground">{plan.name}</h4><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${plan.enabled ? 'bg-success-50 text-success-600' : 'bg-surface text-muted'}`}>{plan.enabled ? t('active') : t('inactive')}</span></div><p className="mt-1 text-xs text-muted">{plan.destination.name}</p></div>{canUpdate && <button type="button" role="switch" aria-checked={plan.enabled} aria-label={t('togglePlan', { name: plan.name })} onClick={() => void togglePlan(plan)} disabled={busy !== null} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-600/40 focus:ring-offset-2 ${plan.enabled ? 'bg-accent-600' : 'bg-border'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${plan.enabled ? 'left-6' : 'left-1'}`} /></button>}</div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><dt className="text-muted">{t('schedule')}</dt><dd className="mt-1 font-medium text-foreground">{formatSchedule(plan, t)}</dd></div><div><dt className="text-muted">{t('nextRun')}</dt><dd className="mt-1 font-medium text-foreground">{plan.nextRunAt ? formatDate(plan.nextRunAt, locale) : t('notScheduled')}</dd></div><div className="col-span-2"><dt className="text-muted">{t('retention')}</dt><dd className="mt-1 font-medium text-foreground">{t('retentionSummary', plan.retention)}</dd></div></dl>
              <div className="mt-4 flex flex-wrap gap-2">{canRun && <button type="button" onClick={() => void runNow(plan)} disabled={busy !== null} className={primaryButton}>{busy === `run-${plan.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{t('runNow')}</button>}{canUpdate && <button type="button" onClick={() => editPlan(plan)} disabled={busy !== null} className={secondaryButton}><Pencil className="h-4 w-4" />{t('edit')}</button>}{canDelete && <button type="button" onClick={() => void removePlan(plan)} disabled={busy !== null} className={dangerButton}><Trash2 className="h-4 w-4" />{t('delete')}</button>}</div>
            </article>
          ))}
          {plans.length === 0 && <p className="xl:col-span-2 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{t('noPlans')}</p>}
        </div>
      </section>

      {canRestore && (
        <RestoreSection
          jobs={jobs}
          destinations={destinations}
          locale={locale}
          busy={busy}
          runbook={runbook}
          acknowledged={restoreAcknowledged}
          onAcknowledge={setRestoreAcknowledged}
          onPrepare={(job) => void prepareRestore(job)}
          onOpen={(job) => void openRestoreAssistant(job)}
          onCopy={(command) => void copyCommand(command)}
          onDownload={downloadRunbook}
        />
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="border-b border-border p-4 sm:p-5"><div className="flex items-center gap-3"><Archive className="h-5 w-5 text-brand-600" /><div><h3 className="font-semibold text-foreground">{t('historyTitle')}</h3><p className="mt-1 text-sm text-muted">{t('historyDescription')}</p></div></div></div>
        {jobs.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted">{t('noJobs')}</p> : <div className="divide-y divide-border">{jobs.map((job) => <JobRow key={job.id} job={job} locale={locale} canRestore={canRestore} busy={busy === `restore-${job.id}`} onRestore={() => void prepareRestore(job)} />)}</div>}
      </section>
    </div>
  );
}

function RestoreSection({
  jobs,
  destinations,
  locale,
  busy,
  runbook,
  acknowledged,
  onAcknowledge,
  onPrepare,
  onOpen,
  onCopy,
  onDownload,
}: {
  jobs: BackupJob[];
  destinations: BackupDestination[];
  locale: string;
  busy: string | null;
  runbook: RestoreRunbook | null;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onPrepare: (job: BackupJob) => void;
  onOpen: (job: BackupJob) => void;
  onCopy: (command: string) => void;
  onDownload: () => void;
}) {
  const t = useTranslations('settings.backups');
  const backups = jobs.filter((job) => job.operation === 'backup' && job.status === 'succeeded' && job.artifactAvailable);
  const preflights = jobs.filter((job) => job.operation === 'restore_preflight');
  const activePreflight = runbook ? jobs.find((job) => job.id === runbook.preflightJobId) : undefined;
  const result = activePreflight?.restorePreflight;

  return <section id="restore-assistant" className="rounded-xl border border-border bg-surface p-4 sm:p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><ListChecks className="h-5 w-5" /></span>
        <div><h3 className="font-semibold text-foreground">{t('restoreAssistantTitle')}</h3><p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t('restoreAssistantDescription')}</p></div>
      </div>
      {runbook && <button type="button" onClick={onDownload} className={secondaryButton}><FileDown className="h-4 w-4" />{t('downloadRunbook')}</button>}
    </div>

    <ol aria-label={t('restoreProgress')} className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(['select', 'check', 'dryRun', 'restore'] as const).map((step, index) => <li key={step} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${runbook || index === 0 ? 'border-accent-600/40 bg-accent-50 text-accent-700' : 'border-border text-muted'}`}><span className="mr-1.5">{index + 1}.</span>{t(`restoreStep.${step}`)}</li>)}
    </ol>

    <div className="mt-5">
      <h4 className="text-sm font-semibold text-foreground">{t('selectBackup')}</h4>
      {backups.length === 0 ? <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{t('noRestorableBackups')}</p> : <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {backups.slice(0, 10).map((backup) => {
          const preflight = preflights.find((job) => job.sourceJobId === backup.id);
          const destination = destinations.find((item) => item.id === backup.destinationId);
          const running = preflight?.status === 'queued' || preflight?.status === 'running';
          const ready = preflight?.status === 'succeeded' && preflight.restorePreflight?.ready === true;
          return <article key={backup.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-foreground">{formatDate(backup.finishedAt ?? backup.createdAt, locale)}</p><p className="mt-1 text-xs text-muted">{destination?.name ?? t('unknown')} · {formatBytes(backup.artifactSize, locale, t('unknown'))}</p></div><span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold text-success-600"><CheckCircle2 className="mr-1 inline h-3 w-3" />{t('integrityAvailable')}</span></div>
            <p className="mt-2 break-all font-mono text-[11px] text-muted">{backup.id}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {ready ? <button type="button" onClick={() => onOpen(preflight)} disabled={busy !== null} className={primaryButton}>{busy === `runbook-${preflight.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}{t('openAssistant')}</button>
                : <button type="button" onClick={() => onPrepare(backup)} disabled={busy !== null || running} className={secondaryButton}>{busy === `restore-${backup.id}` || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{running ? t('preflightRunning') : t('startPreflight')}</button>}
              {preflight?.status === 'failed' && <span className="text-xs font-medium text-danger-600"><AlertCircle className="mr-1 inline h-3.5 w-3.5" />{t('preflightFailed')}</span>}
              {preflight?.status === 'succeeded' && preflight.restorePreflight?.ready === false && <span className="text-xs font-medium text-warning-700"><TriangleAlert className="mr-1 inline h-3.5 w-3.5" />{t('preflightBlocked')}</span>}
            </div>
          </article>;
        })}
      </div>}
    </div>

    {runbook && result && <div className="mt-6 border-t border-border pt-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="font-semibold text-foreground">{t('preflightResult')}</h4><p className="mt-1 break-all text-xs text-muted">{runbook.restorePath}</p></div><span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-xs font-semibold text-success-600 sm:mt-0"><ShieldCheck className="h-3.5 w-3.5" />{t('readyForRestore')}</span></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <RestoreCheck ok={result.integrityVerified} label={t('checkIntegrity')} />
        <RestoreCheck ok={result.databaseArchiveReadable} label={t('checkDatabase')} />
        <RestoreCheck ok={result.uploadsArchiveReadable} label={t('checkUploads')} />
        <RestoreCheck ok={result.compatibility === 'compatible'} label={t('checkCompatibility')} />
        <RestoreCheck ok={result.secrets.every((secret) => !secret.required || secret.configured)} label={t('checkSecrets')} />
        <RestoreCheck ok={result.storage.sufficient} label={t('checkStorage', { available: formatBytes(result.storage.availableBytes, locale, t('unknown')), required: formatBytes(result.storage.requiredBytes, locale, t('unknown')) })} />
      </div>

      <div className="mt-5 space-y-3">
        {runbook.steps.map((step, index) => {
          const hideDangerCommand = step.key === 'restore' && !acknowledged;
          return <article key={step.key} className={`rounded-lg border p-4 ${step.danger ? 'border-danger-500/30' : 'border-border'}`}>
            <div className="flex items-start gap-3"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.danger ? 'bg-danger-50 text-danger-600' : 'bg-background text-foreground'}`}>{index + 1}</span><div className="min-w-0 flex-1"><h5 className="text-sm font-semibold text-foreground">{step.title}</h5><p className="mt-1 text-sm leading-6 text-muted">{step.description}</p>
              {step.command && !hideDangerCommand && <div className="mt-3 flex items-start gap-2 rounded-lg bg-background p-3"><code className="min-w-0 flex-1 select-all break-all text-xs leading-5 text-foreground">{step.command}</code><button type="button" onClick={() => onCopy(step.command as string)} className={iconButton} aria-label={t('copyCommand')}><Clipboard className="h-4 w-4" /></button></div>}
              {hideDangerCommand && <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-sm text-danger-600"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t('restoreCommandLocked')}</p>}
            </div></div>
          </article>;
        })}
      </div>
      <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-600"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} className="mt-0.5 h-4 w-4 accent-danger-600" /><span><span className="font-semibold">{t('restoreAcknowledge')}</span><span className="mt-1 block leading-5">{t('restoreAcknowledgeHint')}</span></span></label>
    </div>}
  </section>;
}

function RestoreCheck({ ok, label }: { ok: boolean; label: string }) {
  return <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${ok ? 'border-success-500/30 bg-success-50 text-success-600' : 'border-danger-500/30 bg-danger-50 text-danger-600'}`}>{ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}<span>{label}</span></div>;
}

function JobRow({ job, locale, canRestore, busy, onRestore }: { job: BackupJob; locale: string; canRestore: boolean; busy: boolean; onRestore: () => void }) {
  const t = useTranslations('settings.backups');
  const statusClass = job.status === 'succeeded' ? 'bg-success-50 text-success-600' : job.status === 'failed' ? 'bg-danger-50 text-danger-600' : job.status === 'running' ? 'bg-accent-50 text-accent-700' : 'bg-background text-muted';
  return <article className="p-4 transition-colors hover:bg-background/60 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}>{t(`jobStatus.${job.status}`)}</span><span className="text-xs text-muted">{t(`jobOperation.${job.operation}`)}</span><span className="text-xs text-muted">{t(`jobTrigger.${job.trigger}`)}</span>{job.operation === 'backup' && job.status === 'succeeded' && !job.artifactAvailable && <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700">{t('expired')}</span>}</div><p className="mt-2 break-all font-mono text-xs text-muted">{job.id}</p>{job.artifactPath && job.operation === 'restore_preflight' && <p className="mt-2 break-all text-xs text-muted"><span className="font-medium text-foreground">{t('restorePath')}:</span> {job.artifactPath}</p>}{job.errorMessage && <p className="mt-2 text-sm text-danger-600">{job.errorMessage}</p>}{canRestore && job.operation === 'backup' && job.status === 'succeeded' && job.artifactAvailable && <button type="button" onClick={onRestore} disabled={busy} className={`${secondaryButton} mt-3`} >{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{t('prepareRestore')}</button>}</div><dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-2 text-xs sm:text-right"><div><dt className="text-muted">{t('started')}</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(job.startedAt ?? job.createdAt, locale)}</dd></div><div><dt className="text-muted">{t('duration')}</dt><dd className="mt-0.5 font-medium text-foreground">{formatDuration(job.durationMs, t('unknown'))}</dd></div><div><dt className="text-muted">{t('size')}</dt><dd className="mt-0.5 font-medium text-foreground">{formatBytes(job.artifactSize, locale, t('unknown'))}</dd></div><div><dt className="text-muted">{t('errorCode')}</dt><dd className="mt-0.5 font-medium text-foreground">{job.errorCode ?? '—'}</dd></div></dl></div></article>;
}

function DestinationFormFields({ draft, onChange }: { draft: DestinationDraft; onChange: (updater: (current: DestinationDraft) => DestinationDraft) => void }) {
  const t = useTranslations('settings.backups');
  const set = <K extends keyof DestinationDraft>(key: K, value: DestinationDraft[K]) => onChange((current) => ({ ...current, [key]: value }));
  const mounted = draft.type === 'local';
  const hostBased = draft.type === 'sftp';

  return <>
    <TextField label={t('destinationName')} value={draft.name} onChange={(value) => set('name', value)} required />
    <SelectField label={t('destinationTypeLabel')} value={draft.type} onChange={(value) => onChange((current) => destinationTypeDraft(current, value as BackupDestinationType))}>
      {(['local', 'sftp', 's3'] as const).map((type) => <option key={type} value={type}>{t(`destinationType.${type}`)}</option>)}
    </SelectField>

    {mounted && <>
      <SelectField label={t('mountName')} value={draft.mountName} onChange={(value) => set('mountName', value)} hint={t('mountHint')}>
        <option value="local">{t('mountOption.local')}</option>
        <option value="network">{t('mountOption.network')}</option>
      </SelectField>
      <TextField label={t('subdirectory')} value={draft.subdirectory} onChange={(value) => set('subdirectory', value)} placeholder="daily/wiki" hint={t('subdirectoryHint')} />
    </>}

    {hostBased && <>
      <TextField label={t('host')} value={draft.host} onChange={(value) => set('host', value)} placeholder="backup.example.org" required />
      <NumberField label={t('port')} value={draft.port} min={1} max={65535} onChange={(value) => set('port', value)} />
      <TextField label={t('username')} value={draft.username} onChange={(value) => set('username', value)} autoComplete="username" required />
      <TextField label={t('basePath')} value={draft.basePath} onChange={(value) => set('basePath', value)} placeholder="/backups/ad-wiki" required />
    </>}

    {draft.type === 'sftp' && <>
      <div className="sm:col-span-2"><TextField label={t('hostKeyFingerprint')} value={draft.hostKeyFingerprint} onChange={(value) => set('hostKeyFingerprint', value)} placeholder="SHA256:…" required hint={t('hostKeyFingerprintHint')} /></div>
      <SelectField label={t('authentication')} value={draft.sftpAuthentication} onChange={(value) => set('sftpAuthentication', value as DestinationDraft['sftpAuthentication'])}>
        <option value="privateKey">{t('privateKey')}</option><option value="password">{t('password')}</option>
      </SelectField>
      {draft.sftpAuthentication === 'password'
        ? <TextField label={t('password')} value={draft.password} onChange={(value) => set('password', value)} type="password" autoComplete="new-password" required />
        : <><div className="sm:col-span-2"><TextAreaField label={t('privateKey')} value={draft.privateKey} onChange={(value) => set('privateKey', value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required hint={t('privateKeyHint')} /></div><TextField label={t('passphrase')} value={draft.passphrase} onChange={(value) => set('passphrase', value)} type="password" autoComplete="new-password" /></>}
    </>}

    {draft.type === 's3' && <>
      <TextField label={t('endpoint')} value={draft.endpoint} onChange={(value) => set('endpoint', value)} type="url" placeholder="https://s3.example.org" required hint={t('endpointHint')} />
      <TextField label={t('region')} value={draft.region} onChange={(value) => set('region', value)} required />
      <TextField label={t('bucket')} value={draft.bucket} onChange={(value) => set('bucket', value)} required />
      <TextField label={t('prefix')} value={draft.prefix} onChange={(value) => set('prefix', value)} placeholder="ad-wiki" />
      <TextField label={t('accessKeyId')} value={draft.accessKeyId} onChange={(value) => set('accessKeyId', value)} autoComplete="off" required />
      <TextField label={t('secretAccessKey')} value={draft.secretAccessKey} onChange={(value) => set('secretAccessKey', value)} type="password" autoComplete="new-password" required />
      <TextField label={t('sessionToken')} value={draft.sessionToken} onChange={(value) => set('sessionToken', value)} type="password" autoComplete="off" />
      <SelectField label={t('serverSideEncryption')} value={draft.serverSideEncryption} onChange={(value) => set('serverSideEncryption', value as DestinationDraft['serverSideEncryption'])}>
        <option value="AES256">SSE-S3 (AES-256)</option><option value="aws:kms">SSE-KMS</option>
      </SelectField>
      {draft.serverSideEncryption === 'aws:kms' && <TextField label={t('kmsKeyId')} value={draft.kmsKeyId} onChange={(value) => set('kmsKeyId', value)} required />}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"><input type="checkbox" checked={draft.forcePathStyle} onChange={(event) => set('forcePathStyle', event.target.checked)} className="h-4 w-4 accent-accent-600" /><span><span className="font-medium">{t('forcePathStyle')}</span><span className="ml-1 text-muted">{t('forcePathStyleHint')}</span></span></label>
    </>}

    {isRemoteType(draft.type) && <p className="text-xs leading-5 text-muted sm:col-span-2">{t('credentialsHint')}</p>}
  </>;
}

function DestinationIcon({ type }: { type: BackupDestinationType }) {
  const Icon = type === 's3' ? Cloud : type === 'sftp' ? Server : HardDrive;
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-4 w-4" /></span>;
}

function DestinationTestStatus({ destination, locale }: { destination: BackupDestination; locale: string }) {
  const t = useTranslations('settings.backups');
  const state = destination.lastTestSucceeded === true ? 'succeeded' : destination.lastTestSucceeded === false ? 'failed' : 'never';
  const color = state === 'succeeded' ? 'text-success-600' : state === 'failed' ? 'text-danger-600' : 'text-muted';
  return <p className={`mt-1.5 text-xs ${color}`}>{t(`testStatus.${state}`)}{destination.lastTestedAt ? ` · ${formatDate(destination.lastTestedAt, locale)}` : ''}</p>;
}

function MetricCard({ icon: Icon, label, value, tone = 'accent' }: { icon: typeof ShieldCheck; label: string; value: string; tone?: 'accent' | 'success' | 'danger' }) {
  const colors = tone === 'success' ? 'bg-success-50 text-success-600' : tone === 'danger' ? 'bg-danger-50 text-danger-600' : 'bg-accent-50 text-accent-700';
  return <div className="rounded-xl border border-border bg-surface p-4"><div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors}`}><Icon className="h-4 w-4" /></div><p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p></div>;
}

function Banner({ children, danger = false, icon: Icon }: { children: ReactNode; danger?: boolean; icon: typeof AlertCircle }) {
  return <div role={danger ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${danger ? 'border-danger-500/30 bg-danger-50 text-danger-600' : 'border-success-500/30 bg-success-50 text-success-600'}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></div>;
}

function TextField({ label, value, onChange, hint, ...props }: { label: string; value: string; onChange: (value: string) => void; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <label className="block"><span className="text-sm font-medium text-foreground">{label}{props.required && <span aria-hidden="true" className="text-danger-600"> *</span>}</span><input {...props} value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} />{hint && <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span>}</label>;
}

function TextAreaField({ label, value, onChange, hint, ...props }: { label: string; value: string; onChange: (value: string) => void; hint?: string } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  return <label className="block"><span className="text-sm font-medium text-foreground">{label}{props.required && <span aria-hidden="true" className="text-danger-600"> *</span>}</span><textarea {...props} value={value} onChange={(event) => onChange(event.target.value)} rows={5} className={`${inputClass} resize-y font-mono text-xs`} />{hint && <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span>}</label>;
}

function NumberField({ label, value, min = 0, max, onChange }: { label: string; value: number; min?: number; max: number; onChange: (value: number) => void }) {
  return <label className="block"><span className="text-sm font-medium text-foreground">{label}</span><input type="number" min={min} max={max} required value={value} onChange={(event) => onChange(Number(event.target.value))} className={inputClass} /></label>;
}

function SelectField({ label, value, onChange, children, hint }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="text-sm font-medium text-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>{children}</select>{hint && <span className="mt-1 block text-xs leading-5 text-muted">{hint}</span>}</label>;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function destinationTypeDraft(current: DestinationDraft, type: BackupDestinationType): DestinationDraft {
  return {
    ...current,
    type,
    port: type === 'sftp' ? 22 : current.port,
    mountName: type === 'local' ? 'local' : current.mountName,
  };
}

function destinationInput(draft: DestinationDraft): unknown {
  const base = { name: draft.name, isEnabled: true };
  if (draft.type === 'local') {
    return { ...base, settings: { type: 'local', config: { mountName: draft.mountName, subdirectory: draft.subdirectory } } };
  }
  if (draft.type === 'sftp') {
    const credentials = draft.sftpAuthentication === 'password'
      ? { password: draft.password }
      : { privateKey: draft.privateKey, ...(draft.passphrase ? { passphrase: draft.passphrase } : {}) };
    return { ...base, settings: { type: 'sftp', config: { host: draft.host, port: draft.port, username: draft.username, basePath: draft.basePath, hostKeyFingerprint: draft.hostKeyFingerprint }, credentials } };
  }
  return {
    ...base,
    settings: {
      type: 's3',
      config: {
        endpoint: draft.endpoint,
        region: draft.region,
        bucket: draft.bucket,
        prefix: draft.prefix,
        forcePathStyle: draft.forcePathStyle,
        serverSideEncryption: draft.serverSideEncryption,
        ...(draft.serverSideEncryption === 'aws:kms' && draft.kmsKeyId ? { kmsKeyId: draft.kmsKeyId } : {}),
      },
      credentials: { accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey, ...(draft.sessionToken ? { sessionToken: draft.sessionToken } : {}) },
    },
  };
}

function isRemoteType(type: BackupDestinationType): boolean {
  return type === 'sftp' || type === 's3';
}

function restoreRunbookMarkdown(runbook: RestoreRunbook): string {
  const steps = runbook.steps.map((step, index) => [
    `## ${index + 1}. ${step.title}`,
    '',
    step.description,
    ...(step.command ? ['', '```powershell', step.command, '```'] : []),
  ].join('\n')).join('\n\n');
  return [
    '# AD-Wiki Restore-Runbook',
    '',
    `- Backup-ID: \`${runbook.backupId}\``,
    `- Restore-Pfad: \`${runbook.restorePath}\``,
    `- Erstellt: ${runbook.generatedAt}`,
    '',
    '> Der echte Restore ersetzt Datenbank und Uploads. Zuerst den Dry-Run ausführen und danach die Dienste stoppen.',
    '',
    steps,
    '',
  ].join('\n');
}

function isDestinationEligible(destination: BackupDestination): boolean {
  return destination.isEnabled && (!isRemoteType(destination.type) || destination.lastTestSucceeded === true);
}

function formatBytes(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return fallback;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** exponent)} ${units[exponent]}`;
}

function formatDuration(value: number | null, fallback: string): string {
  if (value === null) return fallback;
  if (value < 60_000) return `${Math.round(value / 1000)} s`;
  return `${Math.floor(value / 60_000)} min ${Math.round((value % 60_000) / 1000)} s`;
}

function formatSchedule(plan: BackupPlan, t: ReturnType<typeof useTranslations<'settings.backups'>>): string {
  const time = `${String(plan.schedule.hour).padStart(2, '0')}:${String(plan.schedule.minute).padStart(2, '0')}`;
  return `${plan.schedule.weekdays.map((weekday) => t(`weekday.${weekday}`)).join(', ')} · ${time} · ${plan.schedule.timezone}`;
}

function commonTimezones(selected: string): string[] {
  const common = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([selected, local, ...common].filter(Boolean))].sort();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

const inputClass = 'mt-1.5 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';
const primaryButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-600/30 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-background focus:outline-none focus:ring-2 focus:ring-accent-600/30 disabled:cursor-not-allowed disabled:opacity-60';
const dangerButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger-500/40 px-4 py-2 text-sm font-semibold text-danger-600 transition-colors hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-500/30 disabled:cursor-not-allowed disabled:opacity-60';
const iconButton = 'inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-accent-600/30 disabled:cursor-not-allowed disabled:opacity-60';
const iconDangerButton = 'inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-danger-600 transition-colors hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-500/30 disabled:cursor-not-allowed disabled:opacity-60';
