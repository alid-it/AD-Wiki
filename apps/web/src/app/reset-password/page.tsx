'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { ApiClientError, auth } from '@ad-wiki/api-client';
import { ResetPasswordSchema } from '@ad-wiki/shared-types';
import { AuthShell } from '@/components/auth/auth-shell';

const inputClass = 'w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}><ResetPasswordForm /></Suspense>;
}

function ResetPasswordForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t('resetLinkInvalid'));
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = ResetPasswordSchema.safeParse({ token, newPassword: password, confirmPassword: confirmation });
    if (!parsed.success) {
      setError(password !== confirmation ? t('passwordsMismatch') : t('passwordLength'));
      return;
    }
    setSubmitting(true);
    try {
      await auth.resetPassword(parsed.data);
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : t('resetFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell title={t('resetTitle')} subtitle={t('resetSubtitle')} footer={<Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">{t('backToLogin')}</Link>}>
      {complete ? (
        <div className="flex flex-col gap-4"><div role="status" className="flex items-start gap-3 rounded-lg border border-success-500/30 bg-success-50 p-4 text-sm text-success-600"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><span>{t('resetComplete')}</span></div><Link href="/login" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">{t('signInSubmit')}</Link></div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
          <PasswordField id="new-password" label={t('newPassword')} value={password} onChange={setPassword} show={show} toggle={() => setShow((current) => !current)} showLabel={show ? t('hidePassword') : t('showPassword')} />
          <label htmlFor="confirm-password" className="flex flex-col gap-1.5 text-sm font-medium text-foreground">{t('confirmPassword')}<input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClass} /></label>
          <button type="submit" disabled={submitting || !token} className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70">{submitting && <Loader2 className="h-4 w-4 animate-spin" />}{submitting ? t('resetting') : t('resetSubmit')}</button>
        </form>
      )}
    </AuthShell>
  );
}

function PasswordField({ id, label, value, onChange, show, toggle, showLabel }: { id: string; label: string; value: string; onChange: (value: string) => void; show: boolean; toggle: () => void; showLabel: string }) {
  return <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium text-foreground">{label}<div className="relative"><input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} pr-11`} /><button type="button" onClick={toggle} aria-label={showLabel} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-foreground">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>;
}
