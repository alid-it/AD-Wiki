'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  Check,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { acls as aclsApi, ApiClientError } from '@ad-wiki/api-client';
import {
  ACTIONS,
  RESOURCES,
  CreateRoleSchema,
  isPermissionSupported,
  type AclEntry,
  type AclOverview,
  type Action,
  type Resource,
  type RoleAcl,
} from '@ad-wiki/shared-types';
import { useAclLabels } from '@/lib/use-acl-labels';
import { useAuth } from '@/lib/auth-context';

const cellKey = (resource: Resource, action: Action) => `${resource}:${action}`;

type RoleDialog =
  | { mode: 'create' }
  | { mode: 'edit'; role: RoleAcl };

export default function RolesSettingsPage() {
  const t = useTranslations('settings.roles');
  const { hasPermission } = useAuth();
  const canRead = hasPermission('roles', 'read');
  const canCreate = hasPermission('roles', 'create');
  const canUpdate = hasPermission('roles', 'update');
  const canDelete = hasPermission('roles', 'delete');
  const { roleLabel } = useAclLabels();
  const [overview, setOverview] = useState<AclOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<RoleDialog | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (preferredRoleId?: string) => {
    try {
      setError(null);
      const data = await aclsApi.list();
      setOverview(data);
      setActiveRoleId((current) => {
        const preferred = preferredRoleId ?? current;
        return data.roles.some((role) => role.roleId === preferred)
          ? preferred
          : data.roles[0]?.roleId ?? null;
      });
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  if (!canRead) return null;

  if (loading) {
    return (
      <div className="flex justify-center py-16" aria-label={t('loading')}>
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!overview) {
    return <ErrorMessage>{error ?? t('noData')}</ErrorMessage>;
  }

  const activeRole =
    overview.roles.find((role) => role.roleId === activeRoleId) ?? overview.roles[0];

  async function deleteRole(role: RoleAcl) {
    if (
      role.isSystem ||
      !window.confirm(t('deleteConfirm', { name: roleLabel(role.roleName) }))
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await aclsApi.deleteRole(role.roleId);
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('deleteFailed'),
      );
    } finally {
      setDeleting(false);
    }
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

      <div
        className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1"
        role="tablist"
        aria-label={t('roleSelection')}
      >
        {overview.roles.map((role) => (
          <button
            key={role.roleId}
            type="button"
            role="tab"
            aria-selected={role.roleId === activeRole?.roleId}
            onClick={() => setActiveRoleId(role.roleId)}
            className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-600 ${
              role.roleId === activeRole?.roleId
                ? 'bg-accent-600 text-white'
                : 'text-muted hover:bg-background hover:text-foreground'
            }`}
          >
            {role.isSystem ? (
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
            {roleLabel(role.roleName)}
          </button>
        ))}
      </div>

      {activeRole && (
        <>
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  {roleLabel(activeRole.roleName)}
                </h3>
                {activeRole.isSystem && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                    {t('systemRole')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">
                {activeRole.description || t('noDescription')}
              </p>
              <p className="mt-2 text-xs text-muted">
                {t('assignedUsers', { count: activeRole.userCount })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {canUpdate && (
                <button
                  type="button"
                  onClick={() => setDialog({ mode: 'edit', role: activeRole })}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t('edit')}
                </button>
              )}
              {canDelete && !activeRole.isSystem && (
                <button
                  type="button"
                  onClick={() => void deleteRole(activeRole)}
                  disabled={deleting}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-danger-500/40 px-3 py-2 text-sm font-medium text-danger-600 transition-colors duration-200 hover:bg-danger-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('delete')}
                </button>
              )}
            </div>
          </section>
          <RoleMatrix
            key={activeRole.roleId}
            role={activeRole}
            canUpdate={canUpdate}
          />
        </>
      )}

      {dialog && (
        <RoleFormDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onSaved={async (roleId) => {
            setDialog(null);
            await load(roleId);
          }}
        />
      )}
    </div>
  );
}

function RoleFormDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: RoleDialog;
  onClose: () => void;
  onSaved: (roleId: string) => Promise<void>;
}) {
  const t = useTranslations('settings.roles');
  const editing = dialog.mode === 'edit' ? dialog.role : null;
  const [name, setName] = useState(editing?.roleName ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editing) {
        const role = await aclsApi.updateRole(editing.roleId, {
          ...(editing.isSystem ? {} : { name }),
          description,
        });
        await onSaved(role.id);
      } else {
        const parsed = CreateRoleSchema.safeParse({ name, description });
        if (!parsed.success) {
          setError(t('invalidRole'));
          return;
        }
        const role = await aclsApi.createRole(parsed.data);
        await onSaved(role.id);
      }
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : t('metadataSaveFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="role-dialog-title" className="text-lg font-semibold text-foreground">
              {editing ? t('editTitle') : t('createTitle')}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {editing?.isSystem ? t('systemEditHint') : t('formHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            {t('name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value.toLowerCase())}
              disabled={editing?.isSystem}
              required
              minLength={2}
              maxLength={50}
              pattern="[a-z0-9][a-z0-9_-]*"
              aria-describedby="role-name-hint"
              className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:bg-background disabled:opacity-70"
            />
            <span id="role-name-hint" className="text-xs font-normal text-muted">
              {t('nameHint')}
            </span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            {t('description')}
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={300}
              rows={3}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20"
            />
          </label>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {t('saveRole')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RoleMatrix({ role, canUpdate }: { role: RoleAcl; canUpdate: boolean }) {
  const t = useTranslations('settings.roles');
  const { resourceLabel, actionLabel } = useAclLabels();
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    for (const entry of role.entries) {
      next[cellKey(entry.resource, entry.action)] = entry.allowed;
    }
    return next;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(resource: Resource, action: Action) {
    setState((previous) => ({
      ...previous,
      [cellKey(resource, action)]: !previous[cellKey(resource, action)],
    }));
    setSaved(false);
  }

  function setRow(resource: Resource, value: boolean) {
    setState((previous) => {
      const next = { ...previous };
      for (const action of ACTIONS) {
        if (isPermissionSupported(resource, action)) {
          next[cellKey(resource, action)] = value;
        }
      }
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const entries: AclEntry[] = [];
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        if (isPermissionSupported(resource, action)) {
          entries.push({
            resource,
            action,
            allowed: Boolean(state[cellKey(resource, action)]),
          });
        }
      }
    }
    try {
      await aclsApi.setRole(role.roleId, entries);
      setSaved(true);
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
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      {error && <ErrorMessage>{error}</ErrorMessage>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-2 text-left text-xs font-medium text-muted">
                {t('resource')}
              </th>
              {ACTIONS.map((action) => (
                <th
                  key={action}
                  className="px-2 py-2 text-center text-xs font-medium text-muted"
                >
                  {actionLabel(action)}
                </th>
              ))}
              <th className="px-2 py-2 text-right text-xs font-medium text-muted">
                {t('all')}
              </th>
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((resource) => {
              const supportedActions = ACTIONS.filter((action) =>
                isPermissionSupported(resource, action),
              );
              const allOn = supportedActions.every(
                (action) => state[cellKey(resource, action)],
              );
              return (
                <tr key={resource} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 text-sm font-medium text-foreground">
                    {resourceLabel(resource)}
                  </td>
                  {ACTIONS.map((action) => (
                    <td key={action} className="px-2 py-2 text-center">
                      {isPermissionSupported(resource, action) ? (
                        <input
                          type="checkbox"
                          checked={Boolean(state[cellKey(resource, action)])}
                          onChange={() => toggle(resource, action)}
                          disabled={!canUpdate}
                          aria-label={`${resourceLabel(resource)} – ${actionLabel(action)}`}
                          className="h-5 w-5 cursor-pointer accent-accent-600 disabled:cursor-not-allowed"
                        />
                      ) : (
                        <span className="text-border" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setRow(resource, !allOn)}
                      disabled={!canUpdate}
                      className="min-h-11 cursor-pointer text-xs font-medium text-accent-700 transition-colors duration-200 hover:text-accent-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {allOn ? t('none') : t('allShort')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canUpdate && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {t('saveRights')}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-success-600" role="status">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('saved')}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
