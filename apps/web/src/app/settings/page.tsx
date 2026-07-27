'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Save,
  Check,
  AlertCircle,
  Archive,
  Download,
  Palette,
  FileText,
  NotebookPen,
  ShieldCheck,
  Image as ImageIcon,
} from 'lucide-react';
import { acls as aclsApi, settings as settingsApi, wikiExport, ApiClientError } from '@ad-wiki/api-client';
import type { ExportFormat, Setting } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { saveDownload } from '@/lib/download';
import { useSiteName } from '@/lib/site-name-context';
import { useAclLabels } from '@/lib/use-acl-labels';

const inputClass =
  'w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

/** Zuordnung bekannter Setting-Keys zu Übersetzungs-Keys. */
const LABEL_KEYS: Record<string, string> = {
  site_name: 'siteName',
  allow_registration: 'allowRegistration',
  default_role: 'defaultRole',
  default_language: 'defaultLanguage',
  local_login_enabled: 'localLoginEnabled',
};

const DESCRIPTION_KEYS: Record<string, string> = {
  site_name: 'siteNameDescription',
  allow_registration: 'allowRegistrationDescription',
  default_role: 'defaultRoleDescription',
  local_login_enabled: 'localLoginEnabledDescription',
};

export default function GeneralSettingsPage() {
  const t = useTranslations('settings.general');
  const { hasPermission } = useAuth();
  const { roleLabel } = useAclLabels();
  const { setSiteName } = useSiteName();
  const canUpdate = hasPermission('settings', 'update');
  const canExport = hasPermission('exports', 'run');
  const canReadRoles = hasPermission('roles', 'read');
  const [items, setItems] = useState<Setting[]>([]);
  const [roleOptions, setRoleOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([
      settingsApi.list(controller.signal),
      canReadRoles
        ? aclsApi.list(controller.signal).then((overview) =>
            overview.roles.map((role) => ({ id: role.roleId, name: role.roleName })),
          )
        : Promise.resolve([]),
    ])
      .then(([settings, roles]) => {
        setItems(settings);
        setRoleOptions(roles);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(t('loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canReadRoles]);

  async function save(key: string, value: string, confirmRisk = false) {
    setSavingKey(key);
    setSavedKey(null);
    setError(null);
    try {
      const updated = await settingsApi.update(key, { value, confirmRisk });
      setItems((prev) => prev.map((s) => (s.key === key ? updated : s)));
      if (updated.key === 'site_name') setSiteName(updated.value);
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('saveFailed'));
    } finally {
      setSavingKey(null);
    }
  }

  const orderedItems = [...items].sort((a, b) => {
    if (a.key === 'site_name') return -1;
    if (b.key === 'site_name') return 1;
    return a.key.localeCompare(b.key);
  });

  function setLocal(key: string, value: string) {
    setItems((prev) => prev.map((s) => (s.key === key ? { ...s, value } : s)));
  }

  async function exportWiki() {
    setExporting(true);
    setExportProgress(0);
    setError(null);
    try {
      const result = await wikiExport.wiki(exportFormat, (progress) => setExportProgress(progress.percent));
      setExportProgress(100);
      saveDownload(result);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('exportFailed'));
    } finally {
      window.setTimeout(() => { setExporting(false); setExportProgress(null); }, 500);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        <p className="mt-1 text-sm text-muted">{t('headingInfo')}</p>
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

      {orderedItems.map((setting) => (
        <div
          key={setting.key}
          className={`flex flex-col gap-4 rounded-xl border bg-surface p-4 sm:p-5 ${
            setting.key === 'site_name' ? 'border-brand-200' : 'border-border sm:flex-row sm:items-center sm:justify-between'
          }`}
        >
          <div className="flex min-w-0 items-start gap-3">
            {setting.key === 'site_name' && (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Palette className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {LABEL_KEYS[setting.key] ? t(LABEL_KEYS[setting.key]) : setting.key}
              </p>
              {(DESCRIPTION_KEYS[setting.key] || setting.description) && (
                <p className="mt-1 text-sm text-muted">
                  {DESCRIPTION_KEYS[setting.key] ? t(DESCRIPTION_KEYS[setting.key]) : setting.description}
                </p>
              )}
            </div>
          </div>

          <div className={`flex flex-wrap items-center gap-2 ${setting.key === 'site_name' ? 'sm:pl-[52px]' : ''}`}>
            {/* Boolean → Toggle (speichert sofort) */}
            {setting.type === 'boolean' && canUpdate ? (
              <button
                type="button"
                role="switch"
                aria-checked={setting.value === 'true'}
                onClick={() => {
                  const nextValue = setting.value === 'true' ? 'false' : 'true';
                  const disablesLocalLogin =
                    setting.key === 'local_login_enabled' && nextValue === 'false';
                  if (
                    disablesLocalLogin &&
                    !window.confirm(t('localLoginDisableConfirm'))
                  ) {
                    return;
                  }
                  void save(setting.key, nextValue, disablesLocalLogin);
                }}
                disabled={savingKey === setting.key}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  setting.value === 'true' ? 'bg-accent-600' : 'bg-border'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    setting.value === 'true' ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            ) : setting.key === 'default_role' && canUpdate ? (
              <select
                value={setting.value}
                onChange={(e) => save(setting.key, e.target.value)}
                disabled={savingKey === setting.key}
                className={inputClass}
              >
                {(roleOptions.length > 0
                  ? roleOptions
                  : [{ id: setting.value, name: setting.value }]
                ).map((role) => (
                  <option key={role.id} value={role.name}>
                    {roleLabel(role.name)}
                  </option>
                ))}
              </select>
            ) : canUpdate ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={setting.value}
                  onChange={(e) => setLocal(setting.key, e.target.value)}
                  maxLength={setting.key === 'site_name' ? 80 : undefined}
                  className={`${inputClass} ${setting.key === 'site_name' ? 'max-w-md flex-1' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => save(setting.key, setting.value)}
                  disabled={savingKey === setting.key}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-70 cursor-pointer"
                >
                  {savingKey === setting.key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t('save')}
                </button>
              </div>
            ) : <span className="text-sm text-muted">{setting.value}</span>}

            {savedKey === setting.key && (
              <span className="flex items-center gap-1 text-xs text-success-600">
                <Check className="h-3.5 w-3.5" /> {t('saved')}
              </span>
            )}
          </div>
        </div>
      ))}

      {canExport && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                <Archive className="h-5 w-5" />
              </span>
              <div>
              <h2 className="text-base font-semibold text-foreground">{t('wikiExport')}</h2>
              <p className="mt-1 text-sm text-muted">{t('wikiExportInfo')}</p>
              </div>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('exportIncludes')}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { key: 'exportPages', icon: FileText },
                { key: 'exportNotes', icon: NotebookPen },
                { key: 'exportStandards', icon: ShieldCheck },
                { key: 'exportMedia', icon: ImageIcon },
              ].map((item) => (
                <div key={item.key} className="flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm text-foreground">
                  <item.icon className="h-4 w-4 text-accent-600" />
                  {t(item.key)}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground sm:w-56">
                {t('exportFormat')}
                <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)} disabled={exporting} className={`${inputClass} max-w-none`}>
                  <option value="markdown">Markdown</option>
                  <option value="html">HTML</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
              <button type="button" onClick={() => void exportWiki()} disabled={exporting} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {exporting ? t('exporting') : t('downloadExport')}
              </button>
            </div>
            {exporting && (
              <div className="mt-4" aria-live="polite">
                <div className="mb-1 flex justify-between text-xs text-muted"><span>{t('exportProgress')}</span><span>{exportProgress === null ? t('preparing') : `${exportProgress}%`}</span></div>
                <progress className="h-2 w-full overflow-hidden rounded-full accent-accent-600" max={100} value={exportProgress ?? undefined} />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
