'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { apiKeys as apiKeysApi, ApiClientError } from '@ad-wiki/api-client';
import { ApiKeySchema, type ApiKey, type CreatedApiKey } from '@ad-wiki/shared-types';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

export function ApiKeysSection() {
  const t = useTranslations('profile.apiKeys');
  const locale = useLocale();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiKeysApi.list(controller.signal)
      .then(setKeys)
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof ApiClientError ? cause.message : t('loadFailed'));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [t]);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  function openDialog() {
    setCreated(null);
    setName('');
    setExpiresAt('');
    setCopied(false);
    setError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setCreated(null);
    setCopied(false);
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const result = await apiKeysApi.create({
        name: name.trim(),
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999`).toISOString() : null,
      });
      setCreated(result);
      setKeys((current) => [ApiKeySchema.parse(result), ...current]);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : t('createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function deactivate(key: ApiKey) {
    if (!window.confirm(t('deleteConfirm', { name: key.name }))) return;
    setDeactivatingId(key.id);
    setError(null);
    try {
      const updated = await apiKeysApi.deactivate(key.id);
      setKeys((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : t('deleteFailed'));
    } finally {
      setDeactivatingId(null);
    }
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setError(t('copyFailed'));
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
            <p className="mt-1 text-xs text-muted">{t('description')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openDialog}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <Plus className="h-4 w-4" />
          {t('new')}
        </button>
      </div>

      <div className="p-5">
        {error && <InlineError>{error}</InlineError>}
        {loading ? (
          <div className="flex min-h-24 items-center justify-center" aria-label={t('loading')}>
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <KeyRound className="mx-auto h-6 w-6 text-muted" />
            <p className="mt-2 text-sm font-medium text-foreground">{t('empty')}</p>
            <p className="mt-1 text-xs text-muted">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{key.name}</p>
                    <StatusBadge status={key.status} />
                  </div>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                    <div><dt className="inline font-medium">{t('created')}:</dt> <dd className="inline">{formatDate(key.createdAt, locale)}</dd></div>
                    <div><dt className="inline font-medium">{t('lastUsed')}:</dt> <dd className="inline">{key.lastUsedAt ? formatDate(key.lastUsedAt, locale) : t('never')}</dd></div>
                    {key.expiresAt && <div><dt className="inline font-medium">{t('expires')}:</dt> <dd className="inline">{formatDate(key.expiresAt, locale)}</dd></div>}
                  </dl>
                </div>
                {key.isActive && (
                  <button
                    type="button"
                    onClick={() => void deactivate(key)}
                    disabled={deactivatingId === key.id}
                    className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger-500/30 px-3 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deactivatingId === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {t('delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="api-key-dialog-title" className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="api-key-dialog-title" className="text-lg font-semibold text-foreground">{created ? t('createdTitle') : t('dialogTitle')}</h3>
                <p className="mt-1 text-sm text-muted">{created ? t('createdDescription') : t('dialogDescription')}</p>
              </div>
              <button type="button" onClick={closeDialog} aria-label={t('close')} className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {created ? (
              <div className="mt-6">
                <div className="flex items-start gap-2 rounded-lg border border-warning-500/30 bg-warning-50 p-3 text-sm text-warning-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="font-medium">{t('oneTimeWarning')}</p>
                </div>
                <div className="mt-4 flex items-stretch gap-2">
                  <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-3 text-sm text-foreground">{created.key}</code>
                  <button type="button" onClick={() => void copyKey()} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600">
                    {copied ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? t('copied') : t('copy')}
                  </button>
                </div>
                <button type="button" onClick={closeDialog} className="mt-6 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                  {t('savedSecurely')}
                </button>
              </div>
            ) : (
              <form onSubmit={createKey} className="mt-6 space-y-4">
                {error && <InlineError>{error}</InlineError>}
                <label className="block text-sm font-medium text-foreground">
                  {t('name')}
                  <input autoFocus required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('namePlaceholder')} className={`${inputClass} mt-1.5`} />
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t('expiration')}
                  <input type="date" min={new Date().toISOString().slice(0, 10)} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className={`${inputClass} mt-1.5`} />
                  <span className="mt-1 block text-xs font-normal text-muted">{t('expirationHint')}</span>
                </label>
                <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={closeDialog} className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600">{t('cancel')}</button>
                  <button type="submit" disabled={creating || !name.trim()} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60">
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    {t('create')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: ApiKey['status'] }) {
  const t = useTranslations('profile.apiKeys');
  const classes = status === 'active'
    ? 'bg-success-50 text-success-600'
    : status === 'expired'
      ? 'bg-warning-50 text-warning-700'
      : 'bg-background text-muted';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>{t(`status.${status}`)}</span>;
}

function InlineError({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{children}</span></div>;
}

function formatDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
