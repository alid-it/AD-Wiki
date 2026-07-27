'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { ApiClientError, auth } from '@ad-wiki/api-client';
import { LoginSchema, type OidcLoginProvider } from '@ad-wiki/shared-types';
import { AuthShell } from '@/components/auth/auth-shell';
import { useAuth } from '@/lib/auth-context';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-4 py-3 text-base text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { login, completeOidcLogin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'email' | 'password', string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [oidcSubmitting, setOidcSubmitting] = useState(false);
  const [providers, setProviders] = useState<OidcLoginProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    auth
      .oidcProviders(controller.signal)
      .then(setProviders)
      .catch(() => {
        if (!controller.signal.aborted) setProviders([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setProvidersLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const code = parameters.get('oidc_code');
    const oidcError = parameters.get('oidc_error');
    if (!code && !oidcError) return;

    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    if (oidcError) {
      setError(oidcErrorMessage(oidcError, t));
      return;
    }
    if (!code) return;

    setOidcSubmitting(true);
    setError(null);
    void completeOidcLogin(code)
      .then(() => router.replace('/'))
      .catch((exchangeError: unknown) => {
        setError(
          exchangeError instanceof ApiClientError
            ? exchangeError.message
            : t('signInFailed'),
        );
        setOidcSubmitting(false);
      });
  }, [completeOidcLogin, router, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const nextErrors: Partial<Record<'email' | 'password', string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' && !nextErrors.email) {
          nextErrors.email = email.trim() ? t('emailInvalid') : t('emailRequired');
        }
        if (field === 'password' && !nextErrors.password) {
          nextErrors.password = password ? t('passwordLength') : t('passwordRequired');
        }
      }
      setFieldErrors(nextErrors);
      return;
    }
    setSubmitting(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('signInFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t('signInTitle')}
      subtitle={t('signInSubtitle')}
      footer={
        <>
          {t('noAccount')}{' '}
          <Link
            href="/register"
            className="font-medium text-accent-600 transition-colors hover:text-accent-700"
          >
            {t('registerLink')}
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {providersLoading && (
          <div
            role="status"
            className="flex min-h-11 items-center justify-center gap-2 text-sm text-muted"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('loadingSsoProviders')}
          </div>
        )}

        {providers.length > 0 && (
          <div className="flex flex-col gap-2" aria-label={t('ssoProviders')}>
            {providers.map((provider) => (
              <a
                key={provider.slug}
                href={auth.oidcStartUrl(provider.slug)}
                aria-disabled={oidcSubmitting || submitting}
                onClick={(event) => {
                  if (oidcSubmitting || submitting) {
                    event.preventDefault();
                    return;
                  }
                  setOidcSubmitting(true);
                  setError(null);
                }}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-brand-600 bg-surface px-4 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-disabled:pointer-events-none aria-disabled:opacity-60 dark:text-brand-300 dark:hover:bg-brand-950/40"
              >
                {oidcSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {t('continueWithProvider', { provider: provider.name })}
              </a>
            ))}
          </div>
        )}

        {providers.length > 0 && (
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted">
              {t('orLocalLogin')}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            {t('email')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFieldErrors((current) => ({ ...current, email: undefined }));
            }}
            placeholder={t('emailPlaceholder')}
            className={inputClass}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          />
          {fieldErrors.email && <p id="email-error" role="alert" className="text-xs text-danger-600">{fieldErrors.email}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            {t('password')}
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              placeholder={t('passwordPlaceholder')}
              className={`${inputClass} pr-11`}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground cursor-pointer"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {fieldErrors.password && <p id="password-error" role="alert" className="text-xs text-danger-600">{fieldErrors.password}</p>}
          <Link href="/forgot-password" className="self-end text-sm font-medium text-accent-600 transition-colors hover:text-accent-700">{t('forgotPassword')}</Link>
        </div>

        <button
          type="submit"
          disabled={submitting || oidcSubmitting}
          className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-soft-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? t('signingIn') : t('signInSubmit')}
        </button>
        </form>
      </div>
    </AuthShell>
  );
}

function oidcErrorMessage(
  code: string,
  translate: (key: string) => string,
): string {
  switch (code) {
    case 'account_not_linked':
      return translate('ssoAccountNotLinked');
    case 'account_unavailable':
      return translate('ssoAccountUnavailable');
    case 'account_conflict':
      return translate('ssoAccountConflict');
    case 'claims_invalid':
      return translate('ssoClaimsInvalid');
    case 'jit_unavailable':
      return translate('ssoJitUnavailable');
    case 'sync_failed':
      return translate('ssoSyncFailed');
    case 'group_overage_unresolved':
      return translate('ssoGroupOverageUnresolved');
    case 'invalid_request':
      return translate('ssoRequestInvalid');
    default:
      return translate('ssoProviderUnavailable');
  }
}
