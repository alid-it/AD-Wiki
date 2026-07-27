'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { ApiClientError, auth } from '@ad-wiki/api-client';
import { RequestPasswordResetSchema } from '@ad-wiki/shared-types';
import { AuthShell } from '@/components/auth/auth-shell';

const inputClass = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = RequestPasswordResetSchema.safeParse({ email });
    if (!parsed.success) {
      setError(t('emailInvalid'));
      return;
    }
    setSubmitting(true);
    try {
      await auth.forgotPassword(parsed.data);
      setSent(true);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('resetRequestFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title={t('forgotTitle')} subtitle={t('forgotSubtitle')} footer={<Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">{t('backToLogin')}</Link>}>
      {sent ? (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-success-500/30 bg-success-50 p-4 text-sm text-success-600"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><span>{t('resetRequested')}</span></div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          <label htmlFor="email" className="flex flex-col gap-1.5 text-sm font-medium text-foreground">{t('email')}<div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('emailPlaceholder')} className={`${inputClass} pl-10`} /></div></label>
          <button type="submit" disabled={submitting} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-70">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{submitting ? t('requestingReset') : t('requestReset')}</button>
        </form>
      )}
    </AuthShell>
  );
}
