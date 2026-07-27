'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  BookOpen,
} from 'lucide-react';
import { mcpTokens, ApiClientError } from '@ad-wiki/api-client';
import type { CreatedMcpAccessToken, McpAccessToken } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useLocaleSwitcher } from '@/lib/i18n-context';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

export default function McpSettingsPage() {
  const t = useTranslations('settings.mcp');
  const { locale } = useLocaleSwitcher();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('mcp', 'create');
  const canDelete = hasPermission('mcp', 'delete');
  const [tokens, setTokens] = useState<McpAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('Codex');
  const [lifetime, setLifetime] = useState('90');
  const [created, setCreated] = useState<CreatedMcpAccessToken | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    mcpTokens
      .list(controller.signal)
      .then(setTokens)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof ApiClientError ? err.message : t('loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const expiresAt =
        lifetime === 'never'
          ? null
          : new Date(Date.now() + Number(lifetime) * 24 * 60 * 60 * 1000).toISOString();
      const result = await mcpTokens.create({ name: trimmed, expiresAt });
      setCreated(result);
      setTokens((current) => [result, ...current]);
      setName('Codex');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('createFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(token: McpAccessToken) {
    if (!window.confirm(t('revokeConfirm', { name: token.name }))) return;
    setRevokingId(token.id);
    setError(null);
    try {
      const revoked = await mcpTokens.revoke(token.id);
      setTokens((current) => current.map((item) => (item.id === revoked.id ? revoked : item)));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('revokeFailed'));
    } finally {
      setRevokingId(null);
    }
  }

  async function copy(value: string, target: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 1800);
    } catch {
      setError(t('copyFailed'));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('description')}</p>
        </div>
        <Link href="/settings/setup#mcp" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background">
          <BookOpen className="h-4 w-4" />
          {t('openGuide')}
        </Link>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{t('securityTitle')}</h3>
            <p className="mt-1 text-sm text-muted">{t('securityHint')}</p>
          </div>
        </div>
      </section>

      {canCreate && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus className="h-5 w-5 text-brand-600" />
            <h3 className="font-semibold text-foreground">{t('createTitle')}</h3>
          </div>
          <form onSubmit={createToken} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              {t('name')}
              <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={t('namePlaceholder')} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              {t('lifetime')}
              <select className={inputClass} value={lifetime} onChange={(event) => setLifetime(event.target.value)}>
                <option value="30">{t('days30')}</option>
                <option value="90">{t('days90')}</option>
                <option value="365">{t('days365')}</option>
                <option value="never">{t('never')}</option>
              </select>
            </label>
            <button type="submit" disabled={creating || !name.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {creating ? t('creating') : t('create')}
            </button>
          </form>
        </section>
      )}

      {created && (
        <section className="rounded-xl border border-success-500/30 bg-success-50 p-4 sm:p-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground">{t('createdTitle')}</h3>
              <p className="mt-1 text-sm text-muted">{t('createdHint')}</p>
              <div className="mt-3 flex gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-foreground">{created.token}</code>
                <CopyButton copied={copied === 'token'} label={t('copyToken')} onClick={() => copy(created.token, 'token')} />
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-600" />
          <h3 className="font-semibold text-foreground">{t('tokensTitle')}</h3>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
        ) : tokens.length === 0 ? (
          <p className="rounded-lg bg-background px-4 py-8 text-center text-sm text-muted">{t('empty')}</p>
        ) : (
          <div className="divide-y divide-border">
            {tokens.map((token) => (
              <div key={token.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{token.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${token.active ? 'bg-success-50 text-success-600' : 'bg-background text-muted'}`}>
                      {token.active ? t('active') : t('inactive')}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted">{token.tokenPrefix}…</p>
                  <p className="mt-1 text-xs text-muted">
                    {t('createdAt', { date: formatDate(token.createdAt, locale) })} · {token.lastUsedAt ? t('lastUsedAt', { date: formatDate(token.lastUsedAt, locale) }) : t('neverUsed')}
                    {token.expiresAt ? ` · ${t('expiresAt', { date: formatDate(token.expiresAt, locale) })}` : ` · ${t('doesNotExpire')}`}
                  </p>
                </div>
                {canDelete && token.active && (
                  <button type="button" onClick={() => void revokeToken(token)} disabled={revokingId === token.id} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger-500/40 px-3 py-2 text-sm font-semibold text-danger-600 transition-colors hover:bg-danger-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-500 disabled:opacity-60 cursor-pointer">
                    {revokingId === token.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {t('revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CopyButton({ copied, label, onClick }: { copied: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-brand-300 hover:text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 cursor-pointer">
      {copied ? <Check className="h-4 w-4 text-success-600" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
