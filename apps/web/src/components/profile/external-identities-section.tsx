'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Loader2,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { auth, ApiClientError } from '@ad-wiki/api-client';
import type {
  LinkedExternalIdentity,
  OidcLoginProvider,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';

/** Sichere Selbstverwaltung externer Identitäten mit erzwungener Provider-Neuanmeldung. */
export function ExternalIdentitiesSection() {
  const t = useTranslations('profile.externalIdentities');
  const locale = useLocale();
  const { user } = useAuth();
  const [identities, setIdentities] = useState<LinkedExternalIdentity[]>([]);
  const [providers, setProviders] = useState<OidcLoginProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [linked, available] = await Promise.all([
      auth.linkedOidcIdentities(signal),
      auth.oidcProviders(signal),
    ]);
    setIdentities(linked);
    setProviders(available);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal)
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof ApiClientError
              ? loadError.message
              : t('loadFailed'),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, t]);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const result = parameters.get('oidc_link');
    const oidcError = parameters.get('oidc_error');
    if (!result && !oidcError) return;
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    if (result === 'linked') setMessage(t('linked'));
    else if (result === 'unlinked') setMessage(t('unlinked'));
    else if (oidcError) setError(accountError(oidcError, t));
  }, [t]);

  const unlinkedProviders = useMemo(() => {
    const linkedSlugs = new Set(
      identities.map((identity) => identity.provider.slug),
    );
    return providers.filter((provider) => !linkedSlugs.has(provider.slug));
  }, [identities, providers]);

  async function startLink(provider: OidcLoginProvider): Promise<void> {
    setPending(`link:${provider.slug}`);
    setError(null);
    setMessage(null);
    try {
      const result = await auth.startOidcLink(provider.slug);
      window.location.assign(result.authorizationUrl);
    } catch (startError) {
      setError(
        startError instanceof ApiClientError
          ? startError.message
          : t('startFailed'),
      );
      setPending(null);
    }
  }

  async function startUnlink(
    identity: LinkedExternalIdentity,
  ): Promise<void> {
    if (!window.confirm(t('unlinkConfirm', { provider: identity.provider.name }))) {
      return;
    }
    setPending(`unlink:${identity.id}`);
    setError(null);
    setMessage(null);
    try {
      const result = await auth.startOidcUnlink(identity.id);
      window.location.assign(result.authorizationUrl);
    } catch (startError) {
      setError(
        startError instanceof ApiClientError
          ? startError.message
          : t('startFailed'),
      );
      setPending(null);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-100 dark:text-brand-300">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{t('description')}</p>
        </div>
      </div>

      <div aria-live="polite" className="mt-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <p className="flex items-center gap-2 rounded-lg border border-success-500/30 bg-success-50 px-3 py-2.5 text-sm text-success-600">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            {message}
          </p>
        )}
      </div>

      {loading ? (
        <div
          role="status"
          className="mt-4 flex min-h-20 items-center justify-center gap-2 text-sm text-muted"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('loading')}
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t('connected')}
            </h3>
            {identities.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted">
                {t('empty')}
              </p>
            ) : (
              identities.map((identity) => {
                const isPending = pending === `unlink:${identity.id}`;
                return (
                  <div
                    key={identity.id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-foreground">
                        <Link2 className="h-4 w-4 text-brand-600" aria-hidden="true" />
                        {identity.provider.name}
                      </p>
                      <p className="mt-1 break-all text-sm text-muted">
                        {identity.email ?? identity.username ?? t('noProfileValue')}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {identity.lastLoginAt
                          ? t('lastLogin', {
                              date: new Intl.DateTimeFormat(locale, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              }).format(new Date(identity.lastLoginAt)),
                            })
                          : t('neverUsed')}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void startUnlink(identity)}
                      className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger-500/40 px-4 py-2 text-sm font-semibold text-danger-600 transition-colors hover:bg-danger-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Unlink className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t('unlink')}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {unlinkedProviders.length > 0 && (
            <div className="mt-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('available')}
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {unlinkedProviders.map((provider) => {
                  const isPending = pending === `link:${provider.slug}`;
                  return (
                    <button
                      key={provider.slug}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void startLink(provider)}
                      className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-100"
                    >
                      {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Link2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t('linkProvider', { provider: provider.name })}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!user?.hasLocalPassword && (
            <p className="mt-5 rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2.5 text-sm leading-6 text-warning-600">
              {t('noLocalPassword')}{' '}
              <Link
                href="/forgot-password"
                className="cursor-pointer font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {t('setLocalPassword')}
              </Link>
            </p>
          )}

          <p className="mt-4 text-xs leading-5 text-muted">{t('securityHint')}</p>
        </>
      )}
    </section>
  );
}

function accountError(
  code: string,
  translate: (key: string) => string,
): string {
  switch (code) {
    case 'account_conflict':
      return translate('accountConflict');
    case 'claims_invalid':
      return translate('claimsInvalid');
    case 'jit_unavailable':
      return translate('jitUnavailable');
    case 'account_unavailable':
      return translate('accountUnavailable');
    case 'invalid_request':
      return translate('requestInvalid');
    default:
      return translate('providerUnavailable');
  }
}
