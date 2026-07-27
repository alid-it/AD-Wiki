'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, Mail, Save, Send, ShieldCheck } from 'lucide-react';
import { ApiClientError, settings as settingsApi } from '@ad-wiki/api-client';
import {
  UpdateSmtpConfigurationSchema,
  type SmtpConfiguration,
  type SmtpSecurity,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';

type FormState = {
  host: string;
  port: string;
  security: SmtpSecurity;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  isEnabled: boolean;
  clearPassword: boolean;
};

const inputClass = 'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:opacity-60';

function toForm(configuration: SmtpConfiguration): FormState {
  return {
    host: configuration.host,
    port: String(configuration.port),
    security: configuration.security,
    username: configuration.username ?? '',
    password: '',
    fromEmail: configuration.fromEmail,
    fromName: configuration.fromName,
    replyTo: configuration.replyTo ?? '',
    isEnabled: configuration.isEnabled,
    clearPassword: false,
  };
}

export default function SmtpSettingsPage() {
  const t = useTranslations('settings.smtp');
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission('smtp', 'update');
  const canTest = hasPermission('smtp', 'test');
  const [configuration, setConfiguration] = useState<SmtpConfiguration | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    settingsApi.getSmtp(controller.signal)
      .then((data) => {
        setConfiguration(data);
        setForm(toForm(data));
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(t('loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setError(null);
    setNotice(null);
    const parsed = UpdateSmtpConfigurationSchema.safeParse({
      host: form.host,
      port: Number(form.port),
      security: form.security,
      username: form.username.trim() || null,
      ...(form.password ? { password: form.password } : {}),
      clearPassword: form.clearPassword,
      fromEmail: form.fromEmail,
      fromName: form.fromName,
      replyTo: form.replyTo.trim() || null,
      isEnabled: form.isEnabled,
    });
    if (!parsed.success) {
      setError(t('invalid'));
      return;
    }
    setSaving(true);
    try {
      const saved = await settingsApi.updateSmtp(parsed.data);
      setConfiguration(saved);
      setForm(toForm(saved));
      setNotice(t('saved'));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await settingsApi.testSmtp();
      setNotice(t('testSent', { recipient: result.recipient }));
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('testFailed'));
    } finally {
      setTesting(false);
    }
  }

  if (loading || !form || !configuration) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  const disabled = !canUpdate || saving || testing;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
        <p className="mt-1 text-sm text-muted">{t('description')}</p>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-success-500/30 bg-success-50 px-3 py-2.5 text-sm text-success-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span></div>}

      <form onSubmit={save} className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700"><Mail className="h-5 w-5" /></span>
            <div><h3 className="text-sm font-semibold text-foreground">{t('delivery')}</h3><p className="mt-1 text-sm text-muted">{t('deliveryHint')}</p></div>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-foreground">
            <button type="button" role="switch" aria-checked={form.isEnabled} disabled={disabled} onClick={() => update('isEnabled', !form.isEnabled)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${form.isEnabled ? 'bg-success-500' : 'bg-border'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${form.isEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} /></button>
            {t('enabled')}
          </label>
        </div>

        <div className="grid gap-5 p-4 sm:grid-cols-2 sm:p-5">
          <Field label={t('host')} htmlFor="smtp-host"><input id="smtp-host" autoComplete="off" required maxLength={253} value={form.host} onChange={(event) => update('host', event.target.value)} disabled={!canUpdate} placeholder="smtp.example.com" className={inputClass} /></Field>
          <Field label={t('port')} htmlFor="smtp-port"><input id="smtp-port" type="number" min={1} max={65535} required value={form.port} onChange={(event) => update('port', event.target.value)} disabled={!canUpdate} className={inputClass} /></Field>
          <Field label={t('security')} htmlFor="smtp-security"><select id="smtp-security" value={form.security} onChange={(event) => update('security', event.target.value as SmtpSecurity)} disabled={!canUpdate} className={inputClass}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></Field>
          <Field label={t('username')} htmlFor="smtp-username"><input id="smtp-username" autoComplete="username" maxLength={254} value={form.username} onChange={(event) => update('username', event.target.value)} disabled={!canUpdate} className={inputClass} /></Field>
          <Field label={t('password')} hint={configuration.hasPassword ? t('passwordStored') : t('passwordMissing')} htmlFor="smtp-password"><input id="smtp-password" type="password" autoComplete="new-password" maxLength={2000} value={form.password} onChange={(event) => update('password', event.target.value)} disabled={!canUpdate || form.clearPassword} placeholder={configuration.hasPassword ? t('passwordKeep') : ''} className={inputClass} /></Field>
          {configuration.hasPassword && <label className="flex min-h-11 items-center gap-3 self-end text-sm text-foreground"><input type="checkbox" checked={form.clearPassword} onChange={(event) => update('clearPassword', event.target.checked)} disabled={!canUpdate} className="h-4 w-4 rounded border-border accent-accent-600" />{t('clearPassword')}</label>}
          <Field label={t('fromEmail')} htmlFor="smtp-from-email"><input id="smtp-from-email" type="email" required maxLength={254} value={form.fromEmail} onChange={(event) => update('fromEmail', event.target.value)} disabled={!canUpdate} className={inputClass} /></Field>
          <Field label={t('fromName')} htmlFor="smtp-from-name"><input id="smtp-from-name" required maxLength={100} value={form.fromName} onChange={(event) => update('fromName', event.target.value)} disabled={!canUpdate} className={inputClass} /></Field>
          <Field label={t('replyTo')} hint={t('optional')} htmlFor="smtp-reply-to"><input id="smtp-reply-to" type="email" maxLength={254} value={form.replyTo} onChange={(event) => update('replyTo', event.target.value)} disabled={!canUpdate} className={inputClass} /></Field>
        </div>

        <div className="flex flex-col gap-3 border-t border-border bg-background/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="flex items-center gap-2 text-xs text-muted"><ShieldCheck className="h-4 w-4 text-success-600" />{t('secretHint')}</p>
          {(canUpdate || canTest) && <div className="flex flex-col-reverse gap-2 sm:flex-row">{canTest && <button type="button" onClick={() => void testConnection()} disabled={saving || testing || !configuration.host} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-60">{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{t('test')}</button>}{canUpdate && <button type="submit" disabled={disabled} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('save')}</button>}</div>}
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="flex flex-col gap-1.5 text-sm font-medium text-foreground">{label}{children}{hint && <span className="text-xs font-normal text-muted">{hint}</span>}</label>;
}
