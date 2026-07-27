'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Check,
  ChevronRight,
  GitBranch,
  Loader2,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import {
  ApiClientError,
  groups as groupsApi,
  resourceAcls,
  users as usersApi,
} from '@ad-wiki/api-client';
import {
  ACTIONS,
  PERMISSION_CATALOG,
  type Action,
  type AdminUser,
  type GroupSummary,
  type Resource,
  type ResourceAccessDecision,
  type ResourceAclBoundary,
  type ResourceAclEffect,
  type ResourceAclEntry,
  type ResourceAclRecipientType,
  type ResourceAclTargetType,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { dispatchAccessControlUpdated } from '@/lib/access-control-events';
import { useAclLabels } from '@/lib/use-acl-labels';

export interface ResourceAclTarget {
  type: ResourceAclTargetType;
  id: string;
  label: string;
  resources: Resource[];
}

interface ResourceAclButtonProps {
  target: ResourceAclTarget;
  compact?: boolean;
  className?: string;
}

const secondaryButton =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50';

const fieldClass =
  'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground transition-colors duration-200 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:bg-background disabled:opacity-60';

/** Öffnet die einheitliche ACL-Verwaltung direkt am jeweiligen Inhalt. */
export function ResourceAclButton({
  target,
  compact = false,
  className,
}: ResourceAclButtonProps) {
  const t = useTranslations('settings.access');
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);

  if (!hasPermission('resource_acls', 'read')) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('manageFor', { name: target.label })}
        title={t('manageFor', { name: target.label })}
        className={
          className ??
          (compact
            ? 'inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-accent-50 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600'
            : secondaryButton)
        }
      >
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        {!compact && t('manage')}
      </button>
      {open && (
        <ResourceAclDialog target={target} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ResourceAclDialog({
  target,
  onClose,
}: {
  target: ResourceAclTarget;
  onClose: () => void;
}) {
  const t = useTranslations('settings.access');
  const { actionLabel, resourceLabel } = useAclLabels();
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const canUpdate = hasPermission('resource_acls', 'update');
  const canReadUsers = hasPermission('users', 'read');
  const canReadGroups = hasPermission('groups', 'read');
  const [entries, setEntries] = useState<ResourceAclEntry[]>([]);
  const [boundaries, setBoundaries] = useState<ResourceAclBoundary[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipientType, setRecipientType] =
    useState<ResourceAclRecipientType>('group');
  const [recipientId, setRecipientId] = useState('');
  const [ruleAction, setRuleAction] = useState<Action>('read');
  const [effect, setEffect] = useState<ResourceAclEffect>('allow');
  const [inheritToChildren, setInheritToChildren] = useState(true);
  const [selfLockConfirmed, setSelfLockConfirmed] = useState(false);
  const [previewUserId, setPreviewUserId] = useState('');
  const [previewResource, setPreviewResource] = useState<Resource>(
    target.resources[0],
  );
  const [previewAction, setPreviewAction] = useState<Action>('read');
  const [decision, setDecision] = useState<ResourceAccessDecision | null>(null);

  const supportedActions = useMemo(
    () =>
      ACTIONS.filter((action) =>
        target.resources.some((resource) =>
          (PERMISSION_CATALOG[resource] as readonly Action[]).includes(action),
        ),
      ),
    [target.resources],
  );

  const previewActions = useMemo(
    () => [...PERMISSION_CATALOG[previewResource]],
    [previewResource],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [nextEntries, nextBoundaries, nextUsers, nextGroups] =
          await Promise.all([
            resourceAcls.list(
              { targetType: target.type, targetId: target.id },
              signal,
            ),
            resourceAcls.boundaries(
              { targetType: target.type, targetId: target.id },
              signal,
            ),
            canReadUsers ? usersApi.list(signal) : Promise.resolve([]),
            canReadGroups ? groupsApi.list(signal) : Promise.resolve([]),
          ]);
        setEntries(nextEntries);
        setBoundaries(nextBoundaries);
        setUsers(nextUsers.filter((candidate) => candidate.isActive));
        setGroups(nextGroups);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return;
        }
        setError(t('loadFailed'));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canReadGroups, canReadUsers, t, target.id, target.type],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    dialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && busy === null) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [busy, onClose]);

  useEffect(() => {
    if (!supportedActions.includes(ruleAction)) {
      setRuleAction(supportedActions[0] ?? 'read');
    }
  }, [ruleAction, supportedActions]);

  useEffect(() => {
    if (!previewActions.includes(previewAction)) {
      setPreviewAction(previewActions[0] ?? 'read');
    }
  }, [previewAction, previewActions]);

  const selfLockRisk =
    recipientType === 'user' &&
    recipientId === user?.id &&
    effect === 'deny' &&
    (ruleAction === 'read' || ruleAction === 'update');

  function notifyChanged() {
    dispatchAccessControlUpdated({
      scope: 'resource_acls',
      action: 'updated',
    });
    router.refresh();
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipientId || (selfLockRisk && !selfLockConfirmed)) return;
    setBusy('create');
    setError(null);
    try {
      await resourceAcls.create({
        recipientType,
        recipientId,
        targetType: target.type,
        targetId: target.id,
        action: ruleAction,
        effect,
        inheritToChildren,
      });
      setSelfLockConfirmed(false);
      await load();
      notifyChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('saveFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function updateRule(
    entry: ResourceAclEntry,
    input: { effect?: ResourceAclEffect; inheritToChildren?: boolean },
  ) {
    const introducesSelfLock =
      input.effect === 'deny' &&
      entry.recipient.type === 'user' &&
      entry.recipient.id === user?.id &&
      (entry.action === 'read' || entry.action === 'update');
    if (introducesSelfLock && !window.confirm(t('selfLockUpdateConfirm'))) return;

    setBusy(entry.id);
    setError(null);
    try {
      await resourceAcls.update(entry.id, input);
      await load();
      notifyChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('saveFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeRule(entry: ResourceAclEntry) {
    if (!window.confirm(t('deleteRuleConfirm'))) return;
    setBusy(entry.id);
    setError(null);
    try {
      await resourceAcls.remove(entry.id);
      await load();
      notifyChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('deleteFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleBoundary(action: Action) {
    setBusy(`boundary:${action}`);
    setError(null);
    const existing = boundaries.some((boundary) => boundary.action === action);
    try {
      if (existing) {
        await resourceAcls.removeBoundary({
          targetType: target.type,
          targetId: target.id,
          action,
        });
      } else {
        await resourceAcls.setBoundary({
          targetType: target.type,
          targetId: target.id,
          action,
        });
      }
      await load();
      notifyChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('boundaryFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function evaluate() {
    if (!previewUserId) return;
    setBusy('preview');
    setError(null);
    try {
      setDecision(
        await resourceAcls.evaluate({
          userId: previewUserId,
          resource: previewResource,
          action: previewAction,
          targetType: target.type,
          targetId: target.id,
        }),
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('previewFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  const recipientOptions = recipientType === 'user' ? users : groups;
  const decisionInherited =
    decision?.sourceTarget !== null &&
    (decision?.sourceTarget.type !== target.type ||
      decision?.sourceTarget.id !== target.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && busy === null) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-acl-title"
        tabIndex={-1}
        className="max-h-[96dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface shadow-soft-lg focus:outline-none sm:max-w-5xl sm:rounded-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface/95 p-4 backdrop-blur sm:p-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">
              {t(`target_${target.type}`)}
            </p>
            <h2
              id="resource-acl-title"
              className="mt-1 truncate text-xl font-semibold text-foreground"
            >
              {target.label}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('dialogHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            aria-label={t('close')}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <div className="min-w-0 space-y-6">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-600"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <section aria-labelledby="direct-rules-heading">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3
                    id="direct-rules-heading"
                    className="text-base font-semibold text-foreground"
                  >
                    {t('directRules')}
                  </h3>
                  <p className="mt-1 text-sm text-muted">{t('directRulesHint')}</p>
                </div>
                <span className="rounded-full bg-background px-2.5 py-1 text-xs font-semibold text-muted">
                  {entries.length}
                </span>
              </div>

              {loading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-muted" />
                </div>
              ) : entries.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-border p-5 text-center">
                  <LockKeyhole className="mx-auto h-6 w-6 text-muted" />
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {t('noDirectRules')}
                  </p>
                  <p className="mt-1 text-xs text-muted">{t('inheritsOnly')}</p>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-xl border border-border bg-background p-3"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            entry.recipient.type === 'group'
                              ? 'bg-brand-50 text-brand-700'
                              : 'bg-accent-50 text-accent-700'
                          }`}
                        >
                          {entry.recipient.type === 'group' ? (
                            <UsersRound className="h-5 w-5" aria-hidden="true" />
                          ) : (
                            <UserRoundCheck
                              className="h-5 w-5"
                              aria-hidden="true"
                            />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {entry.recipient.label}
                            </p>
                            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
                              {t('direct')}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {actionLabel(entry.action)}
                            {' · '}
                            {entry.inheritToChildren
                              ? t('includingChildren')
                              : t('onlyThisTarget')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void updateRule(entry, {
                                effect:
                                  entry.effect === 'allow' ? 'deny' : 'allow',
                              })
                            }
                            disabled={!canUpdate || busy !== null}
                            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                              entry.effect === 'allow'
                                ? 'border-success-500/40 bg-success-50 text-success-600 focus-visible:outline-success-600'
                                : 'border-danger-500/40 bg-danger-50 text-danger-600 focus-visible:outline-danger-600'
                            } disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {busy === entry.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : entry.effect === 'allow' ? (
                              <Check className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Ban className="h-4 w-4" aria-hidden="true" />
                            )}
                            {t(entry.effect)}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void updateRule(entry, {
                                inheritToChildren: !entry.inheritToChildren,
                              })
                            }
                            disabled={!canUpdate || busy !== null}
                            aria-label={t('toggleInheritance')}
                            className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50 ${
                              entry.inheritToChildren
                                ? 'border-accent-300 bg-accent-50 text-accent-700'
                                : 'border-border bg-surface text-muted'
                            }`}
                          >
                            <GitBranch className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeRule(entry)}
                            disabled={!canUpdate || busy !== null}
                            aria-label={t('deleteRule')}
                            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger-50 hover:text-danger-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canUpdate && (
              <form
                onSubmit={createRule}
                className="rounded-xl border border-border bg-background p-4"
              >
                <h3 className="text-sm font-semibold text-foreground">
                  {t('addRule')}
                </h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-foreground">
                    {t('recipientType')}
                    <select
                      value={recipientType}
                      onChange={(event) => {
                        setRecipientType(
                          event.target.value as ResourceAclRecipientType,
                        );
                        setRecipientId('');
                        setSelfLockConfirmed(false);
                      }}
                      className={`mt-1.5 ${fieldClass}`}
                    >
                      <option value="group">{t('group')}</option>
                      <option value="user">{t('user')}</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium text-foreground">
                    {t('recipient')}
                    <select
                      value={recipientId}
                      onChange={(event) => {
                        setRecipientId(event.target.value);
                        setSelfLockConfirmed(false);
                      }}
                      required
                      className={`mt-1.5 ${fieldClass}`}
                    >
                      <option value="">{t('selectRecipient')}</option>
                      {recipientOptions.map((recipient) => (
                        <option key={recipient.id} value={recipient.id}>
                          {'displayName' in recipient
                            ? recipient.displayName
                            : recipient.name}
                        </option>
                      ))}
                    </select>
                    {recipientOptions.length === 0 && (
                      <span className="mt-1 block text-xs font-normal text-muted">
                        {t(
                          recipientType === 'user'
                            ? 'usersPermissionHint'
                            : 'groupsPermissionHint',
                        )}
                      </span>
                    )}
                  </label>
                  <label className="text-sm font-medium text-foreground">
                    {t('action')}
                    <select
                      value={ruleAction}
                      onChange={(event) => {
                        setRuleAction(event.target.value as Action);
                        setSelfLockConfirmed(false);
                      }}
                      className={`mt-1.5 ${fieldClass}`}
                    >
                      {supportedActions.map((action) => (
                        <option key={action} value={action}>
                          {actionLabel(action)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-foreground">
                    {t('effect')}
                    <select
                      value={effect}
                      onChange={(event) => {
                        setEffect(event.target.value as ResourceAclEffect);
                        setSelfLockConfirmed(false);
                      }}
                      className={`mt-1.5 ${fieldClass}`}
                    >
                      <option value="allow">{t('allow')}</option>
                      <option value="deny">{t('deny')}</option>
                    </select>
                  </label>
                </div>
                <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={inheritToChildren}
                    onChange={(event) =>
                      setInheritToChildren(event.target.checked)
                    }
                    className="h-5 w-5 accent-accent-600"
                  />
                  <span>
                    <span className="font-medium">{t('inherit')}</span>
                    <span className="block text-xs text-muted">
                      {t('inheritHint')}
                    </span>
                  </span>
                </label>

                {selfLockRisk && (
                  <div className="mt-3 rounded-lg border border-warning-500/40 bg-warning-50 p-3 text-sm text-warning-600">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-semibold">{t('selfLockTitle')}</p>
                        <p className="mt-1 text-xs leading-5">
                          {t('selfLockHint')}
                        </p>
                      </div>
                    </div>
                    <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-warning-500/30 bg-surface px-3 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={selfLockConfirmed}
                        onChange={(event) =>
                          setSelfLockConfirmed(event.target.checked)
                        }
                        className="h-5 w-5 accent-warning-600"
                      />
                      {t('selfLockConfirm')}
                    </label>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    busy !== null ||
                    !recipientId ||
                    (selfLockRisk && !selfLockConfirmed)
                  }
                  className="mt-4 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'create' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('addRule')}
                </button>
              </form>
            )}
          </div>

          <aside className="min-w-0 space-y-6">
            <section className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600">
                  <GitBranch className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {t('boundaries')}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {t('boundariesHint')}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {supportedActions.map((action) => {
                  const active = boundaries.some(
                    (boundary) => boundary.action === action,
                  );
                  return (
                    <button
                      key={action}
                      type="button"
                      onClick={() => void toggleBoundary(action)}
                      disabled={!canUpdate || busy !== null}
                      aria-pressed={active}
                      className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? 'border-warning-500/40 bg-warning-50 text-warning-600'
                          : 'border-border bg-surface text-muted hover:text-foreground'
                      }`}
                    >
                      {busy === `boundary:${action}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Ban className="h-4 w-4" aria-hidden="true" />
                      )}
                      {actionLabel(action)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted">
                {t('boundaryLegend')}
              </p>
            </section>

            <section className="rounded-xl border border-accent-200 bg-accent-50 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface text-accent-700">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-accent-800">
                    {t('preview')}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-accent-700">
                    {t('previewHint')}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-medium text-foreground">
                  {t('user')}
                  <select
                    value={previewUserId}
                    onChange={(event) => {
                      setPreviewUserId(event.target.value);
                      setDecision(null);
                    }}
                    className={`mt-1.5 ${fieldClass}`}
                  >
                    <option value="">{t('selectUser')}</option>
                    {users.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.displayName} ({candidate.username})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <label className="text-sm font-medium text-foreground">
                    {t('resource')}
                    <select
                      value={previewResource}
                      onChange={(event) => {
                        setPreviewResource(event.target.value as Resource);
                        setDecision(null);
                      }}
                      className={`mt-1.5 ${fieldClass}`}
                    >
                      {target.resources.map((resource) => (
                        <option key={resource} value={resource}>
                          {resourceLabel(resource)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium text-foreground">
                    {t('action')}
                    <select
                      value={previewAction}
                      onChange={(event) => {
                        setPreviewAction(event.target.value as Action);
                        setDecision(null);
                      }}
                      className={`mt-1.5 ${fieldClass}`}
                    >
                      {previewActions.map((action) => (
                        <option key={action} value={action}>
                          {actionLabel(action)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void evaluate()}
                  disabled={!previewUserId || busy !== null}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'preview' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('evaluate')}
                </button>
              </div>

              {decision && (
                <div
                  aria-live="polite"
                  className={`mt-4 rounded-xl border p-4 ${
                    decision.allowed
                      ? 'border-success-500/40 bg-success-50'
                      : 'border-danger-500/40 bg-danger-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {decision.allowed ? (
                      <Check
                        className="h-5 w-5 text-success-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <Ban
                        className="h-5 w-5 text-danger-600"
                        aria-hidden="true"
                      />
                    )}
                    <p
                      className={`font-semibold ${
                        decision.allowed
                          ? 'text-success-600'
                          : 'text-danger-600'
                      }`}
                    >
                      {t(decision.allowed ? 'accessAllowed' : 'accessDenied')}
                    </p>
                    <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                      {t(
                        decisionInherited
                          ? 'inherited'
                          : decision.sourceTarget
                            ? 'direct'
                            : 'fallback',
                      )}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-foreground">
                    {t(`reason_${decision.reason}`)}
                  </p>
                  {decision.sourceTarget && (
                    <p className="mt-2 text-xs text-muted">
                      {t('decidingSource', {
                        type: t(`target_${decision.sourceTarget.type}`),
                        name: decision.sourceTarget.label,
                      })}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                    {decision.evaluatedPath.map((item, index) => (
                      <span key={`${item.type}:${item.id}`} className="contents">
                        {index > 0 && (
                          <ChevronRight
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                        )}
                        <span className="rounded-full border border-border bg-surface px-2 py-1">
                          {item.label}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-sm font-semibold text-foreground">
                {t('legend')}
              </h3>
              <ul className="mt-3 space-y-2 text-xs text-muted">
                <li className="flex items-center gap-2">
                  <span className="rounded-full border border-border px-2 py-0.5 font-medium">
                    {t('direct')}
                  </span>
                  {t('legendDirect')}
                </li>
                <li className="flex items-center gap-2">
                  <span className="rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700">
                    {t('inherited')}
                  </span>
                  {t('legendInherited')}
                </li>
                <li className="flex items-center gap-2">
                  <Ban className="h-4 w-4 text-warning-600" aria-hidden="true" />
                  {t('legendBoundary')}
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
