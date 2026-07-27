'use client';

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  Check,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UsersRound,
  X,
} from 'lucide-react';
import {
  ApiClientError,
  groups as groupsApi,
} from '@ad-wiki/api-client';
import {
  CreateGroupSchema,
  type GroupMemberUser,
  type GroupMembership,
  type GroupMembershipRole,
  type GroupSummary,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

const fieldClass =
  'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground transition-colors duration-200 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:bg-background disabled:opacity-60';

const secondaryButton =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50';

type GroupDialog =
  | { mode: 'create' }
  | { mode: 'edit'; group: GroupSummary };

export default function GroupsSettingsPage() {
  const t = useTranslations('settings.groups');
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('groups', 'create');
  const canUpdate = hasPermission('groups', 'update');
  const canDelete = hasPermission('groups', 'delete');
  const canManageMembers = hasPermission('groups', 'manage_members');
  const canReadAllGroups = hasPermission('groups', 'read');
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [members, setMembers] = useState<GroupMembership[]>([]);
  const [managedGroupIds, setManagedGroupIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<GroupDialog | null>(null);
  const [memberDialog, setMemberDialog] = useState(false);

  const active =
    groups.find((group) => group.id === activeId) ?? groups[0] ?? null;
  const managesActiveGroup =
    canManageMembers ||
    (active !== null && managedGroupIds.includes(active.id));

  const loadGroups = useCallback(async (preferredId?: string) => {
    setError(null);
    try {
      const [allGroups, ownMemberships] = await Promise.all([
        canReadAllGroups ? groupsApi.list() : Promise.resolve(null),
        groupsApi.mine(),
      ]);
      const managedMemberships = ownMemberships.filter(
        (membership) => membership.role === 'MANAGER',
      );
      setManagedGroupIds(
        managedMemberships.map((membership) => membership.group.id),
      );
      const data =
        allGroups ??
        managedMemberships.map((membership) => membership.group);
      setGroups(data);
      setActiveId((current) => {
        const candidate = preferredId ?? current;
        return data.some((group) => group.id === candidate)
          ? candidate
          : data[0]?.id ?? null;
      });
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [canReadAllGroups, t]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const reloadForAccessChange = () => void loadGroups(activeId ?? undefined);
    window.addEventListener(
      ACCESS_CONTROL_UPDATED_EVENT,
      reloadForAccessChange,
    );
    return () =>
      window.removeEventListener(
        ACCESS_CONTROL_UPDATED_EVENT,
        reloadForAccessChange,
      );
  }, [activeId, loadGroups]);

  useEffect(() => {
    if (!active?.id) {
      setMembers([]);
      return;
    }
    const controller = new AbortController();
    setMembersLoading(true);
    groupsApi
      .members(active.id, controller.signal)
      .then(setMembers)
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return;
        }
        setError(t('membersLoadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setMembersLoading(false);
      });
    return () => controller.abort();
  }, [active?.id, t]);

  async function deleteGroup(group: GroupSummary) {
    if (group.isSystem || !window.confirm(t('deleteConfirm', { name: group.name }))) {
      return;
    }
    setBusy(`delete:${group.id}`);
    setError(null);
    try {
      await groupsApi.remove(group.id);
      await loadGroups();
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

  async function updateMemberRole(
    membership: GroupMembership,
    role: GroupMembershipRole,
  ) {
    if (!active) return;
    setBusy(membership.id);
    setError(null);
    try {
      const updated = await groupsApi.updateMember(
        active.id,
        membership.userId,
        { role },
      );
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('memberUpdateFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(membership: GroupMembership) {
    if (!active || !window.confirm(t('removeMemberConfirm', {
      name: membership.user.displayName,
    }))) {
      return;
    }
    setBusy(membership.id);
    setError(null);
    try {
      await groupsApi.removeMember(active.id, membership.userId);
      setMembers((current) =>
        current.filter((item) => item.id !== membership.id),
      );
      await loadGroups(active.id);
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('memberRemoveFailed'),
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16" aria-label={t('loading')}>
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setDialog({ mode: 'create' })}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('create')}
          </button>
        )}
      </div>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <UsersRound className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 text-sm font-semibold text-foreground">
            {t(canReadAllGroups ? 'empty' : 'noManagedGroups')}
          </p>
          <p className="mt-1 text-sm text-muted">
            {t(canReadAllGroups ? 'emptyHint' : 'noManagedGroupsHint')}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <nav
            aria-label={t('groupSelection')}
            className="flex gap-2 overflow-x-auto xl:flex-col xl:overflow-visible"
          >
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveId(group.id)}
                aria-current={active?.id === group.id ? 'true' : undefined}
                className={`min-h-16 min-w-56 cursor-pointer rounded-xl border p-3 text-left transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 xl:min-w-0 ${
                  active?.id === group.id
                    ? 'border-accent-300 bg-accent-50'
                    : 'border-border bg-surface hover:bg-background'
                }`}
              >
                <span className="flex items-center gap-2">
                  {group.isSystem ? (
                    <ShieldCheck
                      className="h-4 w-4 text-brand-600"
                      aria-hidden="true"
                    />
                  ) : (
                    <UsersRound
                      className="h-4 w-4 text-muted"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate text-sm font-semibold text-foreground">
                    {group.name}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {t('memberCount', { count: group.memberCount })}
                </span>
              </button>
            ))}
          </nav>

          {active && (
            <section className="min-w-0 rounded-xl border border-border bg-surface">
              <header className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">
                      {active.name}
                    </h3>
                    {active.isSystem && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                        {t('systemGroup')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {active.description || t('noDescription')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canUpdate && (
                    <button
                      type="button"
                      onClick={() => setDialog({ mode: 'edit', group: active })}
                      className={secondaryButton}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      {t('edit')}
                    </button>
                  )}
                  {canDelete && !active.isSystem && (
                    <button
                      type="button"
                      onClick={() => void deleteGroup(active)}
                      disabled={busy !== null}
                      aria-label={t('delete')}
                      className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-danger-500/40 text-danger-600 transition-colors duration-200 hover:bg-danger-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === `delete:${active.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </header>

              <div className="p-4 sm:p-5">
                <div className="mb-4 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm text-accent-700">
                  <p className="font-semibold">
                    {t(
                      canManageMembers
                        ? 'globalManagerTitle'
                        : managesActiveGroup
                          ? 'groupManagerTitle'
                          : 'readOnlyTitle',
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    {t(
                      canManageMembers
                        ? 'globalManagerHint'
                        : managesActiveGroup
                          ? 'groupManagerHint'
                          : 'readOnlyHint',
                    )}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {t('members')}
                    </h4>
                    <p className="mt-1 text-xs text-muted">
                      {t('membersHint')}
                    </p>
                  </div>
                  {managesActiveGroup && (
                    <button
                      type="button"
                      onClick={() => setMemberDialog(true)}
                      className={secondaryButton}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('addMembers')}
                    </button>
                  )}
                </div>

                {membersLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted" />
                  </div>
                ) : members.length === 0 ? (
                  <p className="mt-5 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">
                    {t('noMembers')}
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-border">
                    {members.map((membership) => (
                      <li
                        key={membership.id}
                        className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                          {membership.user.displayName
                            .split(/\s+/)
                            .map((part) => part[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {membership.user.displayName}
                          </p>
                          <p className="truncate text-xs text-muted">
                            @{membership.user.username}
                            {!membership.user.isActive && ` · ${t('inactive')}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {canManageMembers ? (
                            <select
                              value={membership.role}
                              onChange={(event) =>
                                void updateMemberRole(
                                  membership,
                                  event.target.value as GroupMembershipRole,
                                )
                              }
                              disabled={busy !== null}
                              aria-label={t('roleFor', {
                                name: membership.user.displayName,
                              })}
                              className="min-h-11 cursor-pointer rounded-lg border border-border bg-surface px-3 text-sm text-foreground focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="MEMBER">{t('roleMember')}</option>
                              <option value="MANAGER">{t('roleManager')}</option>
                            </select>
                          ) : (
                            <span className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-muted">
                              {t(
                                membership.role === 'MANAGER'
                                  ? 'roleManager'
                                  : 'roleMember',
                              )}
                            </span>
                          )}
                          {(canManageMembers ||
                            (managesActiveGroup &&
                              membership.role === 'MEMBER')) && (
                            <button
                              type="button"
                              onClick={() => void removeMember(membership)}
                              disabled={busy !== null}
                              aria-label={t('removeMember', {
                                name: membership.user.displayName,
                              })}
                              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger-50 hover:text-danger-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy === membership.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <UserMinus
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {dialog && (
        <GroupFormDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSaved={async (group) => {
            setDialog(null);
            await loadGroups(group.id);
          }}
        />
      )}
      {memberDialog && active && (
        <AddMembersDialog
          group={active}
          canAssignManagers={canManageMembers}
          onClose={() => setMemberDialog(false)}
          onSaved={async () => {
            setMemberDialog(false);
            setMembers(await groupsApi.members(active.id));
            await loadGroups(active.id);
          }}
        />
      )}
    </div>
  );
}

function GroupFormDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: GroupDialog;
  onClose: () => void;
  onSaved: (group: GroupSummary) => Promise<void>;
}) {
  const t = useTranslations('settings.groups');
  const editing = dialog.mode === 'edit' ? dialog.group : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await onSaved(
          await groupsApi.update(editing.id, {
            name,
            description: description || null,
          }),
        );
      } else {
        const parsed = CreateGroupSchema.safeParse({ name, description });
        if (!parsed.success) {
          setError(t('invalid'));
          return;
        }
        await onSaved(await groupsApi.create(parsed.data));
      }
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={editing ? t('editTitle') : t('createTitle')} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <label className="text-sm font-medium text-foreground">
          {t('name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            minLength={2}
            maxLength={100}
            autoFocus
            className={`mt-1.5 ${fieldClass}`}
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          {t('description')}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={4}
            className={`mt-1.5 ${fieldClass}`}
          />
        </label>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={secondaryButton}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" aria-hidden="true" />
            )}
            {t('save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddMembersDialog({
  group,
  canAssignManagers,
  onClose,
  onSaved,
}: {
  group: GroupSummary;
  canAssignManagers: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.groups');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<GroupMemberUser[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [role, setRole] = useState<GroupMembershipRole>('MEMBER');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingCandidates(true);
      groupsApi
        .memberCandidates(
          group.id,
          { q: query.trim() || undefined },
          controller.signal,
        )
        .then(setCandidates)
        .catch((requestError: unknown) => {
          if (
            requestError instanceof DOMException &&
            requestError.name === 'AbortError'
          ) {
            return;
          }
          setError(t('candidatesLoadFailed'));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingCandidates(false);
        });
    }, query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [group.id, query, t]);

  async function addSelected() {
    if (selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        selected.map((userId) =>
          groupsApi.addMember(group.id, { userId, role }),
        ),
      );
      await onSaved();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('membersAddFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={t('addMembersTitle', { name: group.name })} onClose={onClose}>
      <div className="grid gap-4">
        <label className="text-sm font-medium text-foreground">
          {t('searchUsers')}
          <span className="relative mt-1.5 block">
            <Search
              className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted"
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchPlaceholder')}
              autoFocus
              className={`${fieldClass} pl-10`}
            />
          </span>
        </label>
        <div
          className="max-h-72 overflow-y-auto rounded-xl border border-border"
          role="group"
          aria-label={t('selectUsers')}
        >
          {loadingCandidates ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : candidates.map((candidate) => (
            <label
              key={candidate.id}
              className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-border px-3 last:border-0 hover:bg-background"
            >
              <input
                type="checkbox"
                checked={selected.includes(candidate.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, candidate.id]
                      : current.filter((id) => id !== candidate.id),
                  )
                }
                className="h-5 w-5 accent-accent-600"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {candidate.displayName}
                </span>
                <span className="block truncate text-xs text-muted">
                  @{candidate.username}
                </span>
              </span>
            </label>
          ))}
          {!loadingCandidates && candidates.length === 0 && (
            <p className="p-5 text-center text-sm text-muted">
              {t('noUsersFound')}
            </p>
          )}
        </div>
        {canAssignManagers ? (
          <label className="text-sm font-medium text-foreground">
            {t('membershipRole')}
            <select
              value={role}
              onChange={(event) =>
                setRole(event.target.value as GroupMembershipRole)
              }
              className={`mt-1.5 ${fieldClass}`}
            >
              <option value="MEMBER">{t('roleMember')}</option>
              <option value="MANAGER">{t('roleManager')}</option>
            </select>
          </label>
        ) : (
          <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted">
            {t('managerAddsMembersOnly')}
          </div>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            {t('selectedCount', { count: selected.length })}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={secondaryButton}>
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void addSelected()}
              disabled={saving || selected.length === 0}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {t('addSelected')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('settings.groups');
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-dialog-title"
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-soft-lg sm:max-w-xl sm:rounded-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2
            id="group-dialog-title"
            className="text-lg font-semibold text-foreground"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-600"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
