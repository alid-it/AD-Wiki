'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Cloud,
  Database,
  Files,
  HardDrive,
  KeyRound,
  Mail,
  RefreshCw,
  ScrollText,
  Server,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { settings as settingsApi } from '@ad-wiki/api-client';
import type {
  SystemDependency,
  SystemHealthStatus,
  SystemInfo,
} from '@ad-wiki/shared-types';

const STATUS_STYLES: Record<SystemHealthStatus, string> = {
  healthy: 'border-success-500/30 bg-success-50 text-success-600',
  warning: 'border-warning-500/30 bg-warning-50 text-warning-600',
  critical: 'border-danger-500/30 bg-danger-50 text-danger-600',
  unknown: 'border-border bg-background text-muted',
};

const STATUS_ICONS: Record<SystemHealthStatus, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertCircle,
  unknown: CircleHelp,
};

const SERVICE_ICONS: Record<SystemDependency['id'], typeof Server> = {
  api: Server,
  database: Database,
  redis: Cloud,
};

export default function SystemInfoPage() {
  const t = useTranslations('settings.systemInfo');
  const locale = useLocale();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (background) setRefreshing(true);
    setError(null);
    try {
      setInfo(await settingsApi.getSystemInfo(signal));
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(t('loadFailed'));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal, true);
    }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [load]);

  const formatDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : t('notAvailable');

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label={t('loading')}>
        <div className="h-16 animate-pulse rounded-xl bg-background" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl bg-background" />)}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-background" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t('description')}</p>
        </div>
        <button
          type="button"
          onClick={() => void load(undefined, true)}
          disabled={refreshing}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {info && (
        <>
          <OverallStatus
            info={info}
            overallLabel={t('overallStatus', { status: t(`status.${info.status}`) })}
            versionLabel={t('versionInfo', { version: info.version, environment: info.environment })}
            updatedLabel={t('updatedAt', { value: formatDate(info.generatedAt) })}
          />

          <section aria-labelledby="services-heading">
            <div className="mb-3">
              <h3 id="services-heading" className="text-base font-semibold text-foreground">{t('servicesTitle')}</h3>
              <p className="mt-1 text-sm text-muted">{t('servicesDescription')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {info.services.map((service) => {
                const Icon = SERVICE_ICONS[service.id];
                return (
                  <StatusCard
                    key={service.id}
                    icon={Icon}
                    title={t(`service.${service.id}`)}
                    status={service.status}
                    statusLabel={t(`status.${service.status}`)}
                  >
                    <p>{service.latencyMs === null ? t('notAvailable') : t('latency', { value: service.latencyMs })}</p>
                    {service.mode === 'memory' && <p className="mt-1 text-warning-600">{t('memoryMode')}</p>}
                  </StatusCard>
                );
              })}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <StatusSection
              icon={HardDrive}
              title={t('backupTitle')}
              status={info.backup.status}
              statusLabel={t(`status.${info.backup.status}`)}
            >
              {info.backup.latestFailureOpen && (
                <div className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600">
                  {t('backupFailure', { code: info.backup.lastFailureCode ?? t('unknownCode') })}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                <DataPoint icon={CalendarClock} label={t('lastSuccess')} value={formatDate(info.backup.lastSuccessAt)} />
                <DataPoint icon={Clock3} label={t('backupAge')} value={formatDuration(info.backup.lastSuccessAgeSeconds, locale, t('notAvailable'))} />
                <DataPoint icon={Activity} label={t('activeJobs')} value={String(info.backup.activeJobs)} />
                <DataPoint icon={Clock3} label={t('queuedJobs')} value={String(info.backup.queuedJobs)} />
                <DataPoint icon={Activity} label={t('runningJobs')} value={String(info.backup.runningJobs)} />
                <DataPoint icon={Server} label={t('workerHeartbeat')} value={formatDate(info.backup.workerLastSeenAt)} />
                <DataPoint icon={AlertTriangle} label={t('overduePlans')} value={String(info.backup.overduePlans)} />
                <DataPoint icon={HardDrive} label={t('artifacts')} value={String(info.backup.availableArtifacts)} />
                <DataPoint icon={CalendarClock} label={t('enabledPlans')} value={String(info.backup.enabledPlans)} />
                <DataPoint icon={Database} label={t('lastSize')} value={formatBytes(info.backup.lastSizeBytes, locale, t('notAvailable'))} />
              </dl>
              <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">
                {t('freshnessHint', { hours: info.staleBackupAfterHours })}
              </p>
            </StatusSection>

            <StatusSection
              icon={ShieldCheck}
              title={t('certificateTitle')}
              status={info.certificate.status}
              statusLabel={t(`status.${info.certificate.status}`)}
            >
              {info.certificate.validUntil ? (
                <dl className="space-y-3 text-sm">
                  <DetailRow label={t('validUntil')} value={formatDate(info.certificate.validUntil)} />
                  <DetailRow label={t('daysRemaining')} value={String(info.certificate.daysRemaining)} />
                  <DetailRow label={t('subject')} value={info.certificate.subject ?? t('notAvailable')} />
                  <DetailRow label={t('issuer')} value={info.certificate.issuer ?? t('notAvailable')} />
                  <DetailRow label={t('certificateType')} value={info.certificate.selfSigned ? t('selfSigned') : t('caSigned')} />
                  <DetailRow label={t('fingerprint')} value={info.certificate.fingerprintSha256 ?? t('notAvailable')} mono />
                </dl>
              ) : (
                <div className="rounded-lg bg-background p-4 text-sm leading-6 text-muted">
                  {t('certificateUnavailable')}
                </div>
              )}
            </StatusSection>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <StatusSection
              icon={Files}
              title={t('capacityTitle')}
              status={info.capacity.status}
              statusLabel={t(`status.${info.capacity.status}`)}
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                <DataPoint icon={Files} label={t('mediaCount')} value={String(info.capacity.mediaCount)} />
                <DataPoint icon={HardDrive} label={t('mediaSize')} value={formatBytes(info.capacity.mediaTotalBytes, locale, t('notAvailable'))} />
                <DataPoint icon={HardDrive} label={t('uploadFree')} value={formatBytes(info.capacity.uploadFilesystemFreeBytes, locale, t('notAvailable'))} />
                <DataPoint
                  icon={Activity}
                  label={t('uploadFreePercent')}
                  value={info.capacity.uploadFilesystemFreePercent === null
                    ? t('notAvailable')
                    : `${info.capacity.uploadFilesystemFreePercent.toLocaleString(locale)} %`}
                />
              </dl>
              <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">
                {t('capacityHint')}
              </p>
            </StatusSection>

            <StatusSection
              icon={Mail}
              title={t('smtpTitle')}
              status={info.smtp.status}
              statusLabel={info.smtp.enabled ? t(`status.${info.smtp.status}`) : t('disabled')}
            >
              {info.smtp.latestFailureOpen && (
                <div className="mb-4 rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2.5 text-sm text-warning-600">
                  {t('smtpFailure')}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                <DataPoint icon={Mail} label={t('configuration')} value={info.smtp.configured ? t('configured') : t('notConfigured')} />
                <DataPoint icon={Activity} label={t('smtpState')} value={info.smtp.enabled ? t('enabled') : t('disabled')} />
                <DataPoint icon={CalendarClock} label={t('lastDelivery')} value={formatDate(info.smtp.lastSuccessAt)} />
                <DataPoint icon={AlertTriangle} label={t('deliveryFailures')} value={String(info.smtp.failureCount)} />
              </dl>
            </StatusSection>

            <StatusSection
              icon={ScrollText}
              title={t('auditTitle')}
              status={info.audit.status}
              statusLabel={t(`status.${info.audit.status}`)}
            >
              {info.audit.latestFailureOpen && (
                <div className="mb-4 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600">
                  {t('auditFailure')}
                </div>
              )}
              {!info.audit.databaseReadable && (
                <div className="mb-4 rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2.5 text-sm text-warning-600">
                  {t('auditUnavailable')}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                <DataPoint icon={CalendarClock} label={t('lastAuditWrite')} value={formatDate(info.audit.lastEntryAt)} />
                <DataPoint icon={ScrollText} label={t('auditEntries')} value={String(info.audit.totalEntries)} />
                <DataPoint icon={CheckCircle2} label={t('auditSuccesses')} value={String(info.audit.successCount)} />
                <DataPoint icon={AlertTriangle} label={t('auditFailures')} value={String(info.audit.failureCount)} />
              </dl>
              <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">
                {t('auditHint')}
              </p>
            </StatusSection>

            <StatusSection
              icon={ShieldAlert}
              title={t('securityTitle')}
              status={info.security.status}
              statusLabel={t('securityActive')}
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
                <DataPoint icon={AlertTriangle} label={t('loginFailures')} value={String(info.security.loginFailureCount)} />
                <DataPoint icon={KeyRound} label={t('apiKeyFailures')} value={String(info.security.apiKeyFailureCount)} />
                <DataPoint icon={ShieldAlert} label={t('unauthorizedResponses')} value={String(info.security.unauthorizedCount)} />
                <DataPoint icon={ShieldAlert} label={t('forbiddenResponses')} value={String(info.security.forbiddenCount)} />
                <DataPoint icon={Activity} label={t('rateLimitedResponses')} value={String(info.security.rateLimitedCount)} />
                <DataPoint icon={Server} label={t('mcpFailures')} value={String(info.security.mcpRequestFailureCount)} />
              </dl>
              <p className="mt-4 border-t border-border pt-4 text-xs leading-5 text-muted">
                {t('securityHint')}
              </p>
            </StatusSection>
          </div>

          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby="monitoring-heading">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                <Activity className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h3 id="monitoring-heading" className="font-semibold text-foreground">{t('monitoringTitle')}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{t('monitoringDescription')}</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <Endpoint label={t('liveEndpoint')} value={info.monitoring.livePath} description={t('liveDescription')} />
              <Endpoint label={t('readyEndpoint')} value={info.monitoring.readyPath} description={t('readyDescription')} />
              <Endpoint
                label={t('metricsEndpoint')}
                value={info.monitoring.metricsPath}
                description={info.monitoring.metricsProtected ? t('metricsProtected') : t('metricsDevelopment')}
                icon={KeyRound}
              />
            </div>
            <div className="mt-4">
              <Link
                href="/settings/setup#monitoring"
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-accent-200 bg-accent-50 px-4 py-2 text-sm font-semibold text-accent-700 transition-colors hover:bg-accent-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                {t('monitoringGuideLink')}
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function OverallStatus({ info, overallLabel, versionLabel, updatedLabel }: {
  info: SystemInfo;
  overallLabel: string;
  versionLabel: string;
  updatedLabel: string;
}) {
  const Icon = STATUS_ICONS[info.status];
  return (
    <section className={`flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${STATUS_STYLES[info.status]}`} aria-live="polite">
      <div className="flex items-center gap-3">
        <Icon className="h-7 w-7 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{overallLabel}</p>
          <p className="mt-1 text-sm opacity-90">{versionLabel}</p>
        </div>
      </div>
      <p className="text-sm tabular-nums">{updatedLabel}</p>
    </section>
  );
}

function StatusCard({ icon: Icon, title, status, statusLabel, children }: {
  icon: LucideIcon;
  title: string;
  status: SystemHealthStatus;
  statusLabel: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold text-foreground">
          <Icon className="h-5 w-5 text-accent-600" aria-hidden="true" /> {title}
        </span>
        <StatusBadge status={status} label={statusLabel} />
      </div>
      <div className="mt-4 text-sm text-muted">{children}</div>
    </article>
  );
}

function StatusSection({ icon: Icon, title, status, statusLabel, children }: {
  icon: LucideIcon;
  title: string;
  status: SystemHealthStatus;
  statusLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold text-foreground">
          <Icon className="h-5 w-5 text-accent-600" aria-hidden="true" /> {title}
        </span>
        <StatusBadge status={status} label={statusLabel} />
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ status, label }: { status: SystemHealthStatus; label: string }) {
  const Icon = STATUS_ICONS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </span>
  );
}

function DataPoint({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted"><Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}</dt>
      <dd className="mt-1 break-words font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-border pb-3 last:border-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted">{label}</dt>
      <dd className={`break-words text-foreground ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function Endpoint({ label, value, description, icon: Icon = Activity }: {
  label: string;
  value: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-accent-600" aria-hidden="true" /> {label}</p>
      <code className="mt-2 block overflow-x-auto rounded-md bg-surface px-2 py-1.5 text-xs text-foreground">{value}</code>
      <p className="mt-2 text-xs leading-5 text-muted">{description}</p>
    </div>
  );
}

function formatDuration(seconds: number | null, locale: string, fallback: string): string {
  if (seconds === null) return fallback;
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (seconds < 60) return `${formatter.format(seconds)} s`;
  if (seconds < 3_600) return `${formatter.format(seconds / 60)} min`;
  if (seconds < 86_400) return `${formatter.format(seconds / 3_600)} h`;
  return `${formatter.format(seconds / 86_400)} d`;
}

function formatBytes(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return fallback;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1_024 && unit < units.length - 1) {
    size /= 1_024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
}
