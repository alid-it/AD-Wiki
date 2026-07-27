'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UsersRound,
  XCircle,
} from 'lucide-react';
import {
  ApiClientError,
  auth as authApi,
  identityProviders as providersApi,
} from '@ad-wiki/api-client';
import type {
  CreateIdentityProviderInput,
  IdentityProviderAdmin,
  IdentityProviderConnectionTest,
  IdentityProviderDetails,
  IdentityProviderReferenceData,
  IdentitySyncHistoryEntry,
  IdentitySyncPreview,
  IdentitySyncStatus,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';

const fieldClass =
  'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:opacity-60';
const buttonClass =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = `${buttonClass} border border-border bg-surface text-foreground hover:bg-background`;
const primaryButton = `${buttonClass} bg-accent-600 text-white hover:bg-accent-700`;
const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'
).replace(/\/+$/, '');
const entraTenantPattern =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

type Tab = 'configuration' | 'mappings' | 'synchronization';
type ProviderForm = CreateIdentityProviderInput & { clientSecret: string };

const emptyProvider: ProviderForm = {
  name: '',
  type: 'GENERIC_OIDC',
  issuer: '',
  discoveryUrl: null,
  clientId: '',
  clientAuthMethod: 'CLIENT_SECRET_POST',
  clientSecret: '',
  scopes: ['openid', 'profile', 'email'],
  claimMapping: {
    subject: 'sub',
    email: 'email',
    emailVerified: 'email_verified',
    username: 'preferred_username',
    displayName: 'name',
  },
  isActive: false,
  displayOrder: 0,
  allowJitProvisioning: false,
  defaultRoleId: null,
  groupSyncMode: 'ADD_ONLY',
  groupClaim: null,
  roleClaim: null,
  allowAdminRoleMapping: false,
  maxSessionAgeMinutes: 480,
  entraGraphFallbackEnabled: false,
  entraGraphMembershipMode: 'TRANSITIVE',
  entraGraphCacheTtlMinutes: 15,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function entraIssuerFromTenantId(tenantId: string): string {
  const normalizedTenantId = tenantId.trim();
  return normalizedTenantId
    ? `https://login.microsoftonline.com/${normalizedTenantId}/v2.0`
    : '';
}

function entraTenantIdFromIssuer(issuer: string): string {
  try {
    const url = new URL(issuer);
    if (url.hostname !== 'login.microsoftonline.com') return '';
    const match = url.pathname.match(
      /^\/([0-9a-fA-F-]{36})\/v2\.0\/?$/,
    );
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

export default function IdentityProvidersPage() {
  const t = useTranslations('settings.identityProviders');
  const { hasPermission } = useAuth();
  const canEditProviders = hasPermission('identity_providers', 'update');
  const canEditMappings = hasPermission('identity_mappings', 'update');
  const canReadMappings = hasPermission('identity_mappings', 'read');
  const canReadSync = hasPermission('identity_sync', 'read');
  const canPreviewSync = hasPermission('identity_sync', 'update');

  const [providers, setProviders] = useState<IdentityProviderAdmin[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<IdentityProviderDetails | null>(null);
  const [references, setReferences] =
    useState<IdentityProviderReferenceData | null>(null);
  const [syncStatus, setSyncStatus] = useState<IdentitySyncStatus[]>([]);
  const [history, setHistory] = useState<IdentitySyncHistoryEntry[]>([]);
  const [connection, setConnection] =
    useState<IdentityProviderConnectionTest | null>(null);
  const [preview, setPreview] = useState<IdentitySyncPreview | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyProvider);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>('configuration');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [groupMapping, setGroupMapping] = useState({
    externalGroupId: '',
    externalGroupName: '',
    groupId: '',
  });
  const [roleMapping, setRoleMapping] = useState({
    source: 'GROUP' as 'GROUP' | 'ROLE',
    externalValue: '',
    roleId: '',
    priority: 100,
  });
  const [previewIdentityId, setPreviewIdentityId] = useState('');
  const [previewClaims, setPreviewClaims] = useState(
    '{\n  "groups": [],\n  "roles": []\n}',
  );

  const selected =
    providers.find((provider) => provider.id === selectedId) ?? null;

  const loadProviders = useCallback(async (preferredId?: string) => {
    setError(null);
    try {
      const data = await providersApi.list();
      setProviders(data);
      setSelectedId((current) => {
        const candidate = preferredId ?? current;
        return data.some((provider) => provider.id === candidate)
          ? candidate
          : data[0]?.id ?? null;
      });
    } catch (requestError) {
      setError(errorMessage(requestError, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (!canReadMappings) return;
    const controller = new AbortController();
    providersApi
      .referenceData(controller.signal)
      .then(setReferences)
      .catch((requestError: unknown) => {
        if (
          !(
            requestError instanceof DOMException &&
            requestError.name === 'AbortError'
          )
        ) {
          setError(errorMessage(requestError, t('detailsLoadFailed')));
        }
      });
    return () => controller.abort();
  }, [canReadMappings, t]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    const controller = new AbortController();
    const operations: Promise<unknown>[] = [
      providersApi.get(selectedId, controller.signal).then(setDetails),
    ];
    if (canReadSync) {
      operations.push(
        providersApi
          .synchronizationStatus(selectedId, controller.signal)
          .then(setSyncStatus),
        providersApi
          .synchronizationHistory(selectedId, controller.signal)
          .then(setHistory),
      );
    }
    Promise.all(operations).catch((requestError: unknown) => {
      if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
        setError(errorMessage(requestError, t('detailsLoadFailed')));
      }
    });
    return () => controller.abort();
  }, [canReadSync, selectedId, t]);

  const populateForm = useCallback((provider: IdentityProviderAdmin) => {
    setForm({
      name: provider.name,
      type: provider.type,
      issuer: provider.issuer,
      discoveryUrl: provider.discoveryUrl,
      clientId: provider.clientId,
      clientAuthMethod: provider.clientAuthMethod,
      clientSecret: '',
      scopes: provider.scopes,
      claimMapping: provider.claimMapping,
      isActive: provider.isActive,
      displayOrder: provider.displayOrder,
      allowJitProvisioning: provider.allowJitProvisioning,
      defaultRoleId: provider.defaultRoleId,
      groupSyncMode: provider.groupSyncMode,
      groupClaim: provider.groupClaim,
      roleClaim: provider.roleClaim,
      allowAdminRoleMapping: provider.allowAdminRoleMapping,
      maxSessionAgeMinutes: provider.maxSessionAgeMinutes,
      entraGraphFallbackEnabled: provider.entraGraphFallbackEnabled,
      entraGraphMembershipMode: provider.entraGraphMembershipMode,
      entraGraphCacheTtlMinutes: provider.entraGraphCacheTtlMinutes,
    });
  }, []);

  function beginCreate() {
    setCreating(true);
    setEditing(true);
    setSelectedId(null);
    setDetails(null);
    setForm(emptyProvider);
    setConnection(null);
    setTab('configuration');
  }

  function cancelEdit() {
    setCreating(false);
    setEditing(false);
    if (selected) populateForm(selected);
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (form.allowJitProvisioning && !form.defaultRoleId) {
      setError(t('jitRoleRequired'));
      return;
    }
    setBusy('save');
    setError(null);
    setSuccess(null);
    try {
      if (creating) {
        const input: CreateIdentityProviderInput = {
          ...form,
          clientSecret: form.clientSecret || undefined,
        };
        const created = await providersApi.create(input);
        await loadProviders(created.id);
        setCreating(false);
        setSuccess(t('created'));
      } else if (selected) {
        const deactivating = selected.isActive && !form.isActive;
        const confirmed =
          !deactivating || window.confirm(t('deactivateConfirm'));
        if (!confirmed) return;
        const updated = await providersApi.update(selected.id, {
          ...form,
          clientSecret: form.clientSecret || undefined,
          confirmLastActiveProvider: deactivating,
        });
        await loadProviders(updated.id);
        setSuccess(t('saved'));
      }
      setEditing(false);
    } catch (requestError) {
      setError(errorMessage(requestError, t('saveFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function deleteProvider() {
    if (!selected || !window.confirm(t('deleteConfirm', { name: selected.name }))) {
      return;
    }
    setBusy('delete');
    setError(null);
    try {
      await providersApi.remove(selected.id, {
        confirmLastActiveProvider: selected.isActive,
      });
      setDetails(null);
      setConnection(null);
      await loadProviders();
      setSuccess(t('deleted'));
    } catch (requestError) {
      setError(errorMessage(requestError, t('deleteFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    if (!selected) return;
    setBusy('test');
    setConnection(null);
    setError(null);
    try {
      setConnection(await authApi.testOidcProviderConnection(selected.id));
    } catch (requestError) {
      setError(errorMessage(requestError, t('testFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function addGroupMapping(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy('group');
    setError(null);
    try {
      await providersApi.createGroupMapping(selected.id, {
        externalGroupId: groupMapping.externalGroupId,
        externalGroupName: groupMapping.externalGroupName || null,
        groupId: groupMapping.groupId,
      });
      setGroupMapping({ externalGroupId: '', externalGroupName: '', groupId: '' });
      setDetails(await providersApi.get(selected.id));
    } catch (requestError) {
      setError(errorMessage(requestError, t('mappingFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function addRoleMapping(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy('role');
    setError(null);
    try {
      await providersApi.createRoleMapping(selected.id, roleMapping);
      setRoleMapping({ source: 'GROUP', externalValue: '', roleId: '', priority: 100 });
      setDetails(await providersApi.get(selected.id));
    } catch (requestError) {
      setError(errorMessage(requestError, t('mappingFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function removeMapping(kind: 'group' | 'role', mappingId: string) {
    if (!selected || !window.confirm(t('mappingDeleteConfirm'))) return;
    setBusy(mappingId);
    try {
      if (kind === 'group') {
        await providersApi.removeGroupMapping(selected.id, mappingId);
      } else {
        await providersApi.removeRoleMapping(selected.id, mappingId);
      }
      setDetails(await providersApi.get(selected.id));
    } catch (requestError) {
      setError(errorMessage(requestError, t('mappingDeleteFailed')));
    } finally {
      setBusy(null);
    }
  }

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy('preview');
    setPreview(null);
    setError(null);
    try {
      const parsed: unknown = JSON.parse(previewClaims);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid');
      }
      setPreview(
        await authApi.previewOidcSynchronization(selected.id, {
          externalIdentityId: previewIdentityId,
          claims: parsed as Record<string, unknown>,
        }),
      );
    } catch (requestError) {
      setError(errorMessage(requestError, t('previewFailed')));
    } finally {
      setBusy(null);
    }
  }

  const roleNames = useMemo(
    () => new Map(references?.roles.map((role) => [role.id, role.name]) ?? []),
    [references],
  );
  const groupNames = useMemo(
    () => new Map(references?.groups.map((group) => [group.id, group.name]) ?? []),
    [references],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16" aria-label={t('loading')}>
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t('heading')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p>
        </div>
        {canEditProviders && (
          <button type="button" onClick={beginCreate} className={primaryButton}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('add')}
          </button>
        )}
      </header>

      {(error || success) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            error
              ? 'border-danger-200 bg-danger-50 text-danger-700'
              : 'border-success-200 bg-success-50 text-success-700'
          }`}
        >
          {error ? <AlertCircle className="h-5 w-5 shrink-0" /> : <CheckCircle2 className="h-5 w-5 shrink-0" />}
          <span>{error ?? success}</span>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-surface p-3">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('providerList')}
          </p>
          <div className="space-y-1">
            {providers.map((provider) => (
              <button
                type="button"
                key={provider.id}
                onClick={() => {
                  setSelectedId(provider.id);
                  setCreating(false);
                  setEditing(false);
                  setConnection(null);
                  setPreview(null);
                }}
                className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 ${
                  selectedId === provider.id
                    ? 'bg-accent-50 text-accent-800'
                    : 'hover:bg-background'
                }`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${provider.isActive ? 'bg-success-50 text-success-700' : 'bg-background text-muted'}`}>
                  <Fingerprint className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{provider.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {t(`types.${provider.type}`)} · {provider.isActive ? t('active') : t('inactive')}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            ))}
            {providers.length === 0 && !creating && (
              <p className="px-3 py-8 text-center text-sm text-muted">{t('empty')}</p>
            )}
          </div>
        </aside>

        <main className="min-w-0">
          {creating || selected ? (
            <div className="space-y-5">
              {!creating && selected && (
                <>
                  <section className="rounded-xl border border-border bg-surface p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700">
                          <Fingerprint className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-foreground">{selected.name}</h3>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${selected.isActive ? 'bg-success-50 text-success-700' : 'bg-background text-muted'}`}>
                              {selected.isActive ? t('active') : t('inactive')}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-muted">{selected.issuer}</p>
                          <p className="mt-2 text-xs text-muted">
                            {t('secretState')}: {selected.clientSecretConfigured ? t('configured') : t('notConfigured')}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canEditProviders && (
                          <button type="button" onClick={testConnection} className={secondaryButton} disabled={busy !== null}>
                            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                            {t('test')}
                          </button>
                        )}
                        {canEditProviders && (
                          <button type="button" onClick={() => { populateForm(selected); setEditing(true); }} className={secondaryButton}>
                            {t('edit')}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <Metric label={t('identities')} value={selected.counts.identities} />
                      <Metric label={t('groupMappings')} value={selected.counts.groupMappings} />
                      <Metric label={t('roleMappings')} value={selected.counts.roleMappings} />
                    </div>
                  </section>

                  <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1" role="tablist">
                    {(['configuration', 'mappings', 'synchronization'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        role="tab"
                        aria-selected={tab === item}
                        onClick={() => setTab(item)}
                        className={`min-h-11 shrink-0 cursor-pointer rounded-md px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 ${
                          tab === item ? 'bg-accent-50 text-accent-700' : 'text-muted hover:text-foreground'
                        }`}
                      >
                        {t(`tabs.${item}`)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {(creating || (tab === 'configuration' && editing)) && (
                <ProviderEditor
                  form={form}
                  setForm={setForm}
                  references={references}
                  creating={creating}
                  busy={busy === 'save'}
                  t={t}
                  onSubmit={saveProvider}
                  onCancel={cancelEdit}
                />
              )}

              {!creating && tab === 'configuration' && !editing && selected && (
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h3 className="font-semibold text-foreground">{t('configurationOverview')}</h3>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Definition label={t('providerType')} value={t(`types.${selected.type}`)} />
                    <Definition label={t('providerSlug')} value={selected.slug} />
                    <Definition label={t('clientId')} value={selected.clientId} />
                    <Definition
                      label={t('callbackUrl')}
                      value={`${apiBaseUrl}/auth/oidc/${encodeURIComponent(selected.slug)}/callback`}
                    />
                    <Definition label={t('scopes')} value={selected.scopes.join(', ')} />
                    <Definition label={t('jit')} value={selected.allowJitProvisioning ? t('enabled') : t('disabled')} />
                    <Definition label={t('syncMode')} value={t(`syncModes.${selected.groupSyncMode}`)} />
                    <Definition label={t('defaultRole')} value={selected.defaultRoleId ? roleNames.get(selected.defaultRoleId) ?? '—' : '—'} />
                  </dl>
                  {connection && <ConnectionResult result={connection} t={t} />}
                  {canEditProviders && (
                    <div className="mt-6 flex justify-end">
                      <button type="button" onClick={deleteProvider} disabled={busy !== null} className={`${secondaryButton} border-danger-200 text-danger-700 hover:bg-danger-50`}>
                        <Trash2 className="h-4 w-4" />
                        {t('delete')}
                      </button>
                    </div>
                  )}
                </section>
              )}

              {!creating && tab === 'mappings' && selected && (
                <MappingsPanel
                  details={details}
                  references={references}
                  canEdit={canEditMappings}
                  busy={busy}
                  groupMapping={groupMapping}
                  setGroupMapping={setGroupMapping}
                  roleMapping={roleMapping}
                  setRoleMapping={setRoleMapping}
                  groupNames={groupNames}
                  roleNames={roleNames}
                  onAddGroup={addGroupMapping}
                  onAddRole={addRoleMapping}
                  onRemove={removeMapping}
                  t={t}
                />
              )}

              {!creating && tab === 'synchronization' && selected && (
                <SynchronizationPanel
                  status={syncStatus}
                  history={history}
                  canPreview={canPreviewSync}
                  previewIdentityId={previewIdentityId}
                  setPreviewIdentityId={setPreviewIdentityId}
                  previewClaims={previewClaims}
                  setPreviewClaims={setPreviewClaims}
                  preview={preview}
                  busy={busy === 'preview'}
                  onPreview={runPreview}
                  t={t}
                />
              )}
            </div>
          ) : (
            <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
              <div>
                <Fingerprint className="mx-auto h-10 w-10 text-muted" />
                <h3 className="mt-3 font-semibold text-foreground">{t('noSelection')}</h3>
                <p className="mt-1 text-sm text-muted">{t('noSelectionHelp')}</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

type Translation = ReturnType<typeof useTranslations<'settings.identityProviders'>>;

function ProviderEditor({
  form,
  setForm,
  references,
  creating,
  busy,
  t,
  onSubmit,
  onCancel,
}: {
  form: ProviderForm;
  setForm: (value: ProviderForm) => void;
  references: IdentityProviderReferenceData | null;
  creating: boolean;
  busy: boolean;
  t: Translation;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) =>
    setForm({ ...form, [key]: value });
  const entraTenantId =
    form.type === 'MICROSOFT_ENTRA'
      ? entraTenantIdFromIssuer(form.issuer)
      : '';
  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-xl border border-border bg-surface p-5">
      <div>
        <h3 className="font-semibold text-foreground">{creating ? t('createHeading') : t('editHeading')}</h3>
        <p className="mt-1 text-sm text-muted">{t('formHelp')}</p>
      </div>
      {form.type === 'MICROSOFT_ENTRA' && (
        <div className="rounded-lg border border-accent-200 bg-accent-50 p-4">
          <p className="text-sm font-semibold text-accent-900">
            {t('entraFormTitle')}
          </p>
          <p className="mt-1 text-sm leading-6 text-accent-800">
            {t('entraFormHelp')}
          </p>
        </div>
      )}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <Field label={t('name')} help={t('nameHelp')} required><input className={fieldClass} value={form.name} onChange={(event) => set('name', event.target.value)} required /></Field>
        <Field label={t('providerType')} required>
          <select className={fieldClass} value={form.type} onChange={(event) => set('type', event.target.value as ProviderForm['type'])}>
            <option value="GENERIC_OIDC">{t('types.GENERIC_OIDC')}</option>
            <option value="MICROSOFT_ENTRA">{t('types.MICROSOFT_ENTRA')}</option>
            <option value="KEYCLOAK">{t('types.KEYCLOAK')}</option>
          </select>
        </Field>
        {form.type === 'MICROSOFT_ENTRA' ? (
          <>
            <Field label={t('tenantId')} help={t('tenantIdHelp')} required>
              <input
                className={fieldClass}
                value={entraTenantId}
                pattern={entraTenantPattern}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(event) =>
                  set('issuer', entraIssuerFromTenantId(event.target.value))
                }
                required
              />
            </Field>
            <Field label={t('issuer')} help={t('entraIssuerHelp')}>
              <input
                className={fieldClass}
                value={form.issuer}
                readOnly
                aria-readonly="true"
              />
            </Field>
          </>
        ) : (
          <Field label={t('issuer')} help={t('issuerHelp')} required><input type="url" className={fieldClass} value={form.issuer} onChange={(event) => set('issuer', event.target.value)} required /></Field>
        )}
        <Field label={t('discoveryUrl')} help={form.type === 'MICROSOFT_ENTRA' ? t('entraDiscoveryHelp') : t('optional')}><input type="url" className={fieldClass} value={form.discoveryUrl ?? ''} onChange={(event) => set('discoveryUrl', event.target.value || null)} /></Field>
        <Field label={t('clientId')} help={form.type === 'MICROSOFT_ENTRA' ? t('clientIdHelp') : undefined} required><input className={fieldClass} value={form.clientId} onChange={(event) => set('clientId', event.target.value)} required /></Field>
        <Field label={t('clientAuthentication')} required>
          <select className={fieldClass} value={form.clientAuthMethod} onChange={(event) => set('clientAuthMethod', event.target.value as ProviderForm['clientAuthMethod'])}>
            <option value="CLIENT_SECRET_POST">client_secret_post</option>
            <option value="CLIENT_SECRET_BASIC">client_secret_basic</option>
            <option value="NONE">{t('publicClient')}</option>
          </select>
        </Field>
        <Field label={t('clientSecret')} help={creating ? t('secretCreateHelp') : t('secretEditHelp')}>
          <input type="password" autoComplete="new-password" className={fieldClass} value={form.clientSecret} onChange={(event) => set('clientSecret', event.target.value)} />
        </Field>
        <Field label={t('scopes')} help={t('scopesHelp')} required>
          <input className={fieldClass} value={form.scopes.join(' ')} onChange={(event) => set('scopes', event.target.value.split(/\s+/).filter(Boolean))} required />
        </Field>
        <Field label={t('syncMode')}>
          <select className={fieldClass} value={form.groupSyncMode} onChange={(event) => set('groupSyncMode', event.target.value as ProviderForm['groupSyncMode'])}>
            <option value="ADD_ONLY">{t('syncModes.ADD_ONLY')}</option>
            <option value="MANAGED">{t('syncModes.MANAGED')}</option>
          </select>
        </Field>
        <Field label={t('groupClaim')} help={t('optional')}><input className={fieldClass} value={form.groupClaim ?? ''} onChange={(event) => set('groupClaim', event.target.value || null)} /></Field>
        <Field label={t('roleClaim')} help={t('optional')}><input className={fieldClass} value={form.roleClaim ?? ''} onChange={(event) => set('roleClaim', event.target.value || null)} /></Field>
        <Field label={t('sessionAge')}><input type="number" min={5} max={10080} className={fieldClass} value={form.maxSessionAgeMinutes} onChange={(event) => set('maxSessionAgeMinutes', Number(event.target.value))} /></Field>
        <Field label={t('displayOrder')}><input type="number" min={0} className={fieldClass} value={form.displayOrder} onChange={(event) => set('displayOrder', Number(event.target.value))} /></Field>
      </fieldset>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">
          {t('jitSectionTitle')}
        </legend>
        <p className="mb-3 text-sm leading-6 text-muted">
          {t('jitSectionHelp')}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle label={t('jit')} checked={form.allowJitProvisioning} onChange={(value) => set('allowJitProvisioning', value)} />
          <Field
            label={t('defaultRole')}
            help={t('defaultRoleHelp')}
            required={form.allowJitProvisioning}
          >
            <select
              className={fieldClass}
              value={form.defaultRoleId ?? ''}
              onChange={(event) => set('defaultRoleId', event.target.value || null)}
              required={form.allowJitProvisioning}
              aria-invalid={form.allowJitProvisioning && !form.defaultRoleId}
            >
              <option value="">{t('none')}</option>
              {references?.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </Field>
        </div>
        {form.allowJitProvisioning && !form.defaultRoleId && (
          <p className="mt-3 flex items-start gap-2 text-sm text-danger-700" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('jitRoleRequired')}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-foreground">{t('claimMapping')}</legend>
        <p className="mt-1 text-sm text-muted">{t('claimMappingHelp')}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(form.claimMapping) as Array<keyof ProviderForm['claimMapping']>).map((key) => (
            <Field key={key} label={t(`claims.${key}`)}>
              <input className={fieldClass} value={form.claimMapping[key]} onChange={(event) => set('claimMapping', { ...form.claimMapping, [key]: event.target.value })} required />
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
        <Toggle label={t('activeProvider')} checked={form.isActive} onChange={(value) => set('isActive', value)} />
        <Toggle label={t('allowAdminMapping')} checked={form.allowAdminRoleMapping} onChange={(value) => set('allowAdminRoleMapping', value)} />
        {form.type === 'MICROSOFT_ENTRA' && (
          <Toggle label={t('graphFallback')} checked={form.entraGraphFallbackEnabled} onChange={(value) => set('entraGraphFallbackEnabled', value)} />
        )}
      </fieldset>

      {form.type === 'MICROSOFT_ENTRA' && form.entraGraphFallbackEnabled && (
        <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <Field label={t('graphMembership')}>
            <select className={fieldClass} value={form.entraGraphMembershipMode} onChange={(event) => set('entraGraphMembershipMode', event.target.value as ProviderForm['entraGraphMembershipMode'])}>
              <option value="DIRECT">{t('direct')}</option>
              <option value="TRANSITIVE">{t('transitive')}</option>
            </select>
          </Field>
          <Field label={t('cacheTtl')}><input type="number" min={1} max={60} className={fieldClass} value={form.entraGraphCacheTtlMinutes} onChange={(event) => set('entraGraphCacheTtlMinutes', Number(event.target.value))} /></Field>
        </fieldset>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} className={secondaryButton}>{t('cancel')}</button>
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('save')}
        </button>
      </div>
    </form>
  );
}

function MappingsPanel(props: {
  details: IdentityProviderDetails | null;
  references: IdentityProviderReferenceData | null;
  canEdit: boolean;
  busy: string | null;
  groupMapping: { externalGroupId: string; externalGroupName: string; groupId: string };
  setGroupMapping: (value: { externalGroupId: string; externalGroupName: string; groupId: string }) => void;
  roleMapping: { source: 'GROUP' | 'ROLE'; externalValue: string; roleId: string; priority: number };
  setRoleMapping: (value: { source: 'GROUP' | 'ROLE'; externalValue: string; roleId: string; priority: number }) => void;
  groupNames: Map<string, string>;
  roleNames: Map<string, string>;
  onAddGroup: (event: FormEvent) => void;
  onAddRole: (event: FormEvent) => void;
  onRemove: (kind: 'group' | 'role', id: string) => void;
  t: Translation;
}) {
  const { details, references, canEdit, busy, groupMapping, setGroupMapping, roleMapping, setRoleMapping, groupNames, roleNames, onAddGroup, onAddRole, onRemove, t } = props;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <MappingCard title={t('groupMappings')} icon={<UsersRound className="h-5 w-5" />} help={t('groupMappingHelp')}>
        {canEdit && (
          <form onSubmit={onAddGroup} className="space-y-3 rounded-lg bg-background p-3">
            <Field label={t('externalGroupId')}><input required className={fieldClass} value={groupMapping.externalGroupId} onChange={(event) => setGroupMapping({ ...groupMapping, externalGroupId: event.target.value })} /></Field>
            <Field label={t('externalGroupName')} help={t('optional')}><input className={fieldClass} value={groupMapping.externalGroupName} onChange={(event) => setGroupMapping({ ...groupMapping, externalGroupName: event.target.value })} /></Field>
            <Field label={t('localGroup')}><select required className={fieldClass} value={groupMapping.groupId} onChange={(event) => setGroupMapping({ ...groupMapping, groupId: event.target.value })}><option value="">{t('choose')}</option>{references?.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></Field>
            <button className={secondaryButton} disabled={busy !== null}><Plus className="h-4 w-4" />{t('addMapping')}</button>
          </form>
        )}
        <div className="space-y-2">
          {details?.groupMappings.map((mapping) => (
            <MappingRow key={mapping.id} title={mapping.externalGroupName ?? mapping.externalGroupId} target={groupNames.get(mapping.groupId) ?? mapping.groupId} canEdit={canEdit} busy={busy === mapping.id} onRemove={() => onRemove('group', mapping.id)} />
          ))}
          {!details?.groupMappings.length && <EmptyText text={t('noGroupMappings')} />}
        </div>
      </MappingCard>

      <MappingCard title={t('roleMappings')} icon={<ShieldCheck className="h-5 w-5" />} help={t('roleMappingHelp')}>
        {canEdit && (
          <form onSubmit={onAddRole} className="space-y-3 rounded-lg bg-background p-3">
            <Field label={t('claimSource')}><select className={fieldClass} value={roleMapping.source} onChange={(event) => setRoleMapping({ ...roleMapping, source: event.target.value as 'GROUP' | 'ROLE' })}><option value="GROUP">{t('sourceGroup')}</option><option value="ROLE">{t('sourceRole')}</option></select></Field>
            <Field label={t('externalValue')}><input required className={fieldClass} value={roleMapping.externalValue} onChange={(event) => setRoleMapping({ ...roleMapping, externalValue: event.target.value })} /></Field>
            <Field label={t('localRole')}><select required className={fieldClass} value={roleMapping.roleId} onChange={(event) => setRoleMapping({ ...roleMapping, roleId: event.target.value })}><option value="">{t('choose')}</option>{references?.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>
            <Field label={t('priority')}><input type="number" min={0} className={fieldClass} value={roleMapping.priority} onChange={(event) => setRoleMapping({ ...roleMapping, priority: Number(event.target.value) })} /></Field>
            <button className={secondaryButton} disabled={busy !== null}><Plus className="h-4 w-4" />{t('addMapping')}</button>
          </form>
        )}
        <div className="space-y-2">
          {details?.roleMappings.map((mapping) => (
            <MappingRow key={mapping.id} title={`${mapping.source}: ${mapping.externalValue}`} target={`${roleNames.get(mapping.roleId) ?? mapping.roleId} · ${mapping.priority}`} canEdit={canEdit} busy={busy === mapping.id} onRemove={() => onRemove('role', mapping.id)} />
          ))}
          {!details?.roleMappings.length && <EmptyText text={t('noRoleMappings')} />}
        </div>
      </MappingCard>
    </div>
  );
}

function SynchronizationPanel(props: {
  status: IdentitySyncStatus[];
  history: IdentitySyncHistoryEntry[];
  canPreview: boolean;
  previewIdentityId: string;
  setPreviewIdentityId: (value: string) => void;
  previewClaims: string;
  setPreviewClaims: (value: string) => void;
  preview: IdentitySyncPreview | null;
  busy: boolean;
  onPreview: (event: FormEvent) => void;
  t: Translation;
}) {
  const { status, history, canPreview, previewIdentityId, setPreviewIdentityId, previewClaims, setPreviewClaims, preview, busy, onPreview, t } = props;
  return (
    <div className="space-y-5">
      {canPreview && (
        <form onSubmit={onPreview} className="rounded-xl border border-border bg-surface p-5">
          <h3 className="font-semibold text-foreground">{t('syncPreview')}</h3>
          <p className="mt-1 text-sm text-muted">{t('syncPreviewHelp')}</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label={t('identity')}><select required className={fieldClass} value={previewIdentityId} onChange={(event) => setPreviewIdentityId(event.target.value)}><option value="">{t('choose')}</option>{status.map((identity) => <option key={identity.id} value={identity.id}>{identity.userDisplayName} · {identity.email ?? identity.username ?? identity.id}</option>)}</select></Field>
            <Field label={t('exampleClaims')}><textarea required rows={6} className={`${fieldClass} font-mono text-sm`} value={previewClaims} onChange={(event) => setPreviewClaims(event.target.value)} /></Field>
          </div>
          <button className={`${primaryButton} mt-4`} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{t('calculatePreview')}</button>
          {preview && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label={t('groupsAdded')} value={preview.groups.add.length} />
              <Metric label={t('groupsRemoved')} value={preview.groups.remove.length} />
              <Metric label={t('roleChanged')} value={preview.role.changed ? t('yes') : t('no')} />
            </div>
          )}
        </form>
      )}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-semibold text-foreground">{t('syncStatus')}</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">{t('user')}</th><th className="px-3 py-2">{t('lastLogin')}</th><th className="px-3 py-2">{t('lastSync')}</th><th className="px-3 py-2">{t('claimsCount')}</th><th className="px-3 py-2">{t('state')}</th></tr></thead>
            <tbody>{status.map((item) => <tr key={item.id} className="border-b border-border last:border-0"><td className="px-3 py-3"><span className="font-medium text-foreground">{item.userDisplayName}</span><span className="block text-xs text-muted">{item.email ?? item.username}</span></td><td className="px-3 py-3 text-muted">{formatDate(item.lastLoginAt)}</td><td className="px-3 py-3 text-muted">{formatDate(item.lastGroupSyncAt)}</td><td className="px-3 py-3 text-muted">{item.groupClaimCount} / {item.roleClaimCount}</td><td className="px-3 py-3">{item.lastSyncErrorCode ? <span className="text-danger-700">{item.lastSyncErrorCode}</span> : <span className="text-success-700">{t('ok')}</span>}</td></tr>)}</tbody>
          </table>
          {status.length === 0 && <EmptyText text={t('noIdentities')} />}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-semibold text-foreground">{t('syncHistory')}</h3>
        <div className="mt-3 space-y-2">
          {history.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-4 rounded-lg bg-background p-3 text-sm"><span className="text-foreground">{t(`history.${entry.action}`)}</span><time className="shrink-0 text-xs text-muted">{formatDate(entry.createdAt)}</time></div>)}
          {history.length === 0 && <EmptyText text={t('noHistory')} />}
        </div>
      </section>
    </div>
  );
}

function ConnectionResult({ result, t }: { result: IdentityProviderConnectionTest; t: Translation }) {
  return (
    <div className={`mt-5 rounded-lg border p-4 ${result.ok ? 'border-success-200 bg-success-50' : 'border-danger-200 bg-danger-50'}`}>
      <div className="flex items-center gap-2 font-medium text-foreground">{result.ok ? <CheckCircle2 className="h-5 w-5 text-success-700" /> : <XCircle className="h-5 w-5 text-danger-700" />}{result.ok ? t('testSuccessful') : t('testUnsuccessful')}</div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">{result.checks.map((check) => <li key={check.name} className="flex items-start gap-2 text-sm"><span className={check.ok ? 'text-success-700' : 'text-danger-700'}>{check.ok ? '✓' : '×'}</span><span><strong>{check.name}</strong><span className="block text-muted">{check.message}</span></span></li>)}</ul>
    </div>
  );
}

function Field({ label, help, required, children }: { label: string; help?: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium text-foreground">{label}{required && <span className="ml-1 text-danger-600">*</span>}</span>{children}{help && <span className="mt-1 block text-xs text-muted">{help}</span>}</label>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-foreground"><input type="checkbox" className="h-5 w-5 rounded border-border accent-accent-600" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-background p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-semibold text-foreground">{value}</dd></div>;
}
function Definition({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt><dd className="mt-1 break-all text-sm text-foreground">{value}</dd></div>;
}
function MappingCard({ title, help, icon, children }: { title: string; help: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="space-y-4 rounded-xl border border-border bg-surface p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700">{icon}</span><div><h3 className="font-semibold text-foreground">{title}</h3><p className="mt-1 text-sm text-muted">{help}</p></div></div>{children}</section>;
}
function MappingRow({ title, target, canEdit, busy, onRemove }: { title: string; target: string; canEdit: boolean; busy: boolean; onRemove: () => void }) {
  return <div className="flex min-h-14 items-center gap-3 rounded-lg border border-border p-3"><KeyRound className="h-4 w-4 shrink-0 text-muted" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{title}</p><p className="truncate text-xs text-muted">→ {target}</p></div>{canEdit && <button type="button" onClick={onRemove} disabled={busy} className="grid h-11 w-11 cursor-pointer place-items-center rounded-lg text-danger-700 hover:bg-danger-50 disabled:opacity-50" aria-label="Mapping löschen">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>}</div>;
}
function EmptyText({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted">{text}</p>;
}
function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
}
