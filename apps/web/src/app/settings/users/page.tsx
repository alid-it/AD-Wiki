'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  AlertCircle,
  ShieldCheck,
  ChevronDown,
  Save,
  Check,
  Dices,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';
import {
  users as usersApi,
  ApiClientError,
} from '@ad-wiki/api-client';
import {
  RESOURCES,
  ACTIONS,
  AdminResetPasswordSchema,
  CreateUserSchema,
  isPermissionSupported,
  type AdminUser,
  type RoleOption,
  type Resource,
  type Action,
  type AclEntry,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAclLabels } from '@/lib/use-acl-labels';

/** Override-Zustand einer Zelle: kein Override, erlaubt oder verboten. */
type Override = 'inherit' | 'allow' | 'deny';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

const cellKey = (r: Resource, a: Action) => `${r}:${a}`;

export default function UsersSettingsPage() {
  const { user: currentUser, hasPermission } = useAuth();
  const canUpdate = hasPermission('users', 'update');
  const canAssignRole = hasPermission('users', 'assign_role');
  const canCreate = hasPermission('users', 'create') && canAssignRole;
  const canReadOverrides = hasPermission('user_permissions', 'read');
  const canUpdateOverrides = hasPermission('user_permissions', 'update');
  const canResetPassword = hasPermission('users', 'reset_password');
  const t = useTranslations('settings.users');
  const { roleLabel } = useAclLabels();
  const [items, setItems] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    try {
      const [nextUsers, nextRoles] = await Promise.all([
        usersApi.list(),
        canAssignRole ? usersApi.roleOptions() : Promise.resolve([]),
      ]);
      setItems(nextUsers);
      setRoles(nextRoles);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [canAssignRole]);

  async function changeRole(u: AdminUser, roleId: string) {
    if (roleId === u.roleId) return;
    setBusyId(u.id);
    setError(null);
    try {
      const updated = await usersApi.assignRole(u.id, { roleId });
      setItems((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('roleChangeFailed'));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(u: AdminUser) {
    setBusyId(u.id);
    setError(null);
    try {
      const updated = await usersApi.update(u.id, { isActive: !u.isActive });
      setItems((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('statusChangeFailed'));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2><p className="mt-1 text-sm text-muted">{t('description')}</p></div>
        {canCreate && <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"><Plus className="h-4 w-4" />{t('create')}</button>}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && <div role="status" className="flex items-start gap-2 rounded-lg border border-success-500/30 bg-success-50 px-3 py-2.5 text-sm text-success-600"><Check className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span></div>}

      <ul className="flex flex-col gap-2">
        {items.map((u) => {
          const isSelf = u.id === currentUser?.id;
          const isManagementLocked = isSelf || u.isProtected;
          const expanded = expandedId === u.id;
          return (
            <li key={u.id} className="rounded-xl border border-border bg-surface">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      u.isActive ? 'bg-brand-100 text-brand-700' : 'bg-background text-muted'
                    }`}
                  >
                    {initials(u.displayName)}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                      {u.displayName}
                      {isSelf && (
                        <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700">
                          {t('you')}
                        </span>
                      )}
                      {u.isProtected && (
                        <span
                          title={t('protectedHint')}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700"
                        >
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          {t('protectedAccount')}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Rolle */}
                  {canAssignRole ? <select
                    value={u.roleId}
                    onChange={(e) => changeRole(u, e.target.value)}
                    disabled={busyId === u.id || isManagementLocked}
                    title={u.isProtected ? t('protectedHint') : isSelf ? t('cannotChangeOwnRole') : undefined}
                    className="min-h-11 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground transition-colors focus:border-accent-600 focus:outline-none disabled:opacity-60 cursor-pointer"
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {roleLabel(role.name)}
                      </option>
                    ))}
                  </select> : (
                    <span className="rounded-full bg-background px-3 py-1.5 text-sm font-medium text-foreground">
                      {roleLabel(u.role)}
                    </span>
                  )}

                  {/* Aktiv-Toggle */}
                  {canUpdate && <button
                    type="button"
                    role="switch"
                    aria-checked={u.isActive}
                    onClick={() => toggleActive(u)}
                    disabled={busyId === u.id || isManagementLocked}
                    title={
                      u.isProtected
                        ? t('protectedHint')
                        : isSelf
                        ? t('cannotDeactivateSelf')
                        : u.isActive
                          ? t('activeClickToLock')
                          : t('lockedClickToActivate')
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 cursor-pointer ${
                      u.isActive ? 'bg-success-500' : 'bg-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        u.isActive ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>}

                  {/* Permissions ausklappen */}
                  {canReadOverrides && <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : u.id)}
                    aria-expanded={expanded}
                    disabled={u.isProtected}
                    title={u.isProtected ? t('protectedHint') : undefined}
                    className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {t('permissions')}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        expanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>}
                  {canResetPassword && <button type="button" onClick={() => setPasswordUser(u)} disabled={u.isProtected} aria-label={t('passwordActionsFor', { name: u.displayName })} title={u.isProtected ? t('protectedHint') : t('passwordActions')} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"><KeyRound className="h-4 w-4" /></button>}
                </div>
              </div>

              {expanded && canReadOverrides && !u.isProtected && <PermissionOverrides userId={u.id} canUpdate={canUpdateOverrides} />}
            </li>
          );
        })}
      </ul>
      {createOpen && <CreateUserDialog roles={roles} onClose={() => setCreateOpen(false)} onCreated={(created) => { setItems((current) => [...current, created]); setCreateOpen(false); setNotice(t('created')); }} />}
      {passwordUser && <PasswordDialog user={passwordUser} isSelf={passwordUser.id === currentUser?.id} onClose={() => setPasswordUser(null)} onNotice={(message) => { setPasswordUser(null); setNotice(message); }} />}
    </div>
  );
}

/** Ausklappbarer Editor für die individuellen Rechte-Overrides eines Users. */
const dialogInputClass = 'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

const PASSWORD_CHARACTER_GROUPS = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%*-_=+?',
] as const;

/** Erzeugt ein starkes Passwort mit Web Crypto und mindestens einem Zeichen je Gruppe. */
function generatePassword(length = 20): string {
  const allCharacters = PASSWORD_CHARACTER_GROUPS.join('');
  const characters = PASSWORD_CHARACTER_GROUPS.map((group) => randomCharacter(group));
  while (characters.length < length) characters.push(randomCharacter(allCharacters));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

function randomCharacter(characters: string): string {
  return characters[secureRandomIndex(characters.length)] ?? '';
}

function secureRandomIndex(maximum: number): number {
  const randomValue = new Uint32Array(1);
  const unbiasedLimit = Math.floor(0x1_0000_0000 / maximum) * maximum;
  do globalThis.crypto.getRandomValues(randomValue);
  while ((randomValue[0] ?? 0) >= unbiasedLimit);
  return (randomValue[0] ?? 0) % maximum;
}

function Modal({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-slate-950/50"><div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5"><div><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm text-muted">{description}</p></div><button type="button" onClick={onClose} aria-label="Dialog schließen" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-background hover:text-foreground"><X className="h-5 w-5" /></button></div>{children}</dialog>;
}

function CreateUserDialog({ roles, onClose, onCreated }: { roles: RoleOption[]; onClose: () => void; onCreated: (user: AdminUser) => void }) {
  const t = useTranslations('settings.users');
  const { roleLabel } = useAclLabels();
  const initialRoleId = roles.find((role) => role.name === 'viewer')?.id ?? roles[0]?.id ?? '';
  const [form, setForm] = useState({ email: '', username: '', displayName: '', roleId: initialRoleId, password: '', confirmPassword: '' });
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fillGeneratedPassword() {
    const generatedPassword = generatePassword();
    setForm((current) => ({
      ...current,
      password: generatedPassword,
      confirmPassword: generatedPassword,
    }));
    setShow(true);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = CreateUserSchema.safeParse(form);
    if (!parsed.success) { setError(t('invalidInput')); return; }
    setSaving(true);
    try { onCreated(await usersApi.create(parsed.data)); }
    catch (reason) { setError(reason instanceof ApiClientError ? reason.message : t('createFailed')); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={t('createTitle')} description={t('createDescription')} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-600 sm:col-span-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        <FormField label={t('displayName')} id="create-display"><input id="create-display" autoFocus required maxLength={100} value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} className={dialogInputClass} /></FormField>
        <FormField label={t('username')} id="create-username"><input id="create-username" autoComplete="off" required minLength={3} maxLength={50} value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} className={dialogInputClass} /></FormField>
        <FormField label={t('email')} id="create-email"><input id="create-email" type="email" autoComplete="off" required maxLength={254} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={dialogInputClass} /></FormField>
        <FormField label={t('role')} id="create-role"><select id="create-role" required value={form.roleId} onChange={(event) => setForm((current) => ({ ...current, roleId: event.target.value }))} className={dialogInputClass}>{roles.map((role) => <option key={role.id} value={role.id}>{roleLabel(role.name)}</option>)}</select></FormField>
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">{t('generatePasswordHint')}</p>
          <button type="button" onClick={fillGeneratedPassword} className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600">
            <Dices className="h-4 w-4" />
            {t('generatePassword')}
          </button>
        </div>
        <FormField label={t('initialPassword')} id="create-password"><PasswordInput id="create-password" value={form.password} onChange={(password) => setForm((current) => ({ ...current, password }))} show={show} toggle={() => setShow((current) => !current)} showLabel={show ? t('hidePassword') : t('showPassword')} /></FormField>
        <FormField label={t('confirmPassword')} id="create-confirm"><input id="create-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required maxLength={128} value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} className={dialogInputClass} /></FormField>
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:col-span-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-background">{t('cancel')}</button><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}{t('create')}</button></div>
      </form>
    </Modal>
  );
}

function PasswordDialog({ user, isSelf, onClose, onNotice }: { user: AdminUser; isSelf: boolean; onClose: () => void; onNotice: (message: string) => void }) {
  const t = useTranslations('settings.users');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'email' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendEmail() {
    setBusy('email'); setError(null);
    try { await usersApi.sendPasswordResetEmail(user.id); onNotice(t('emailSent', { email: user.email })); }
    catch (reason) { setError(reason instanceof ApiClientError ? reason.message : t('emailFailed')); }
    finally { setBusy(null); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const parsed = AdminResetPasswordSchema.safeParse({ newPassword: password, confirmPassword: confirmation });
    if (!parsed.success) { setError(t('invalidPassword')); return; }
    setBusy('password');
    try { await usersApi.resetPassword(user.id, parsed.data); onNotice(t('passwordResetDone', { name: user.displayName })); }
    catch (reason) { setError(reason instanceof ApiClientError ? reason.message : t('passwordResetFailed')); }
    finally { setBusy(null); }
  }

  return <Modal title={t('passwordTitle', { name: user.displayName })} description={t('passwordDescription')} onClose={onClose}><div className="flex flex-col gap-5 p-4 sm:p-5">{error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 p-3 text-sm text-danger-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}<section className="rounded-lg border border-border p-4"><div className="flex items-start gap-3"><Mail className="mt-0.5 h-5 w-5 text-accent-600" /><div className="flex-1"><h4 className="text-sm font-semibold">{t('sendEmail')}</h4><p className="mt-1 text-sm text-muted">{t('sendEmailHint', { email: user.email })}</p></div></div><button type="button" onClick={() => void sendEmail()} disabled={busy !== null || !user.isActive} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-semibold hover:bg-background disabled:opacity-60">{busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}{t('sendResetLink')}</button></section><form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border p-4"><div><h4 className="text-sm font-semibold">{t('setDirectly')}</h4><p className="mt-1 text-sm text-muted">{isSelf ? t('selfPasswordHint') : t('setDirectlyHint')}</p></div><FormField label={t('newPassword')} id="admin-password"><PasswordInput id="admin-password" value={password} onChange={setPassword} show={show} toggle={() => setShow((current) => !current)} showLabel={show ? t('hidePassword') : t('showPassword')} /></FormField><FormField label={t('confirmPassword')} id="admin-confirm"><input id="admin-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={dialogInputClass} /></FormField><button type="submit" disabled={busy !== null || isSelf} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{busy === 'password' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{t('resetPassword')}</button></form></div></Modal>;
}

function FormField({ label, id, children }: { label: string; id: string; children: ReactNode }) { return <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium text-foreground">{label}{children}</label>; }
function PasswordInput({ id, value, onChange, show, toggle, showLabel }: { id: string; value: string; onChange: (value: string) => void; show: boolean; toggle: () => void; showLabel: string }) { return <div className="relative"><input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={128} value={value} onChange={(event) => onChange(event.target.value)} className={`${dialogInputClass} pr-11`} /><button type="button" onClick={toggle} aria-label={showLabel} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:text-foreground">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>; }

function PermissionOverrides({ userId, canUpdate }: { userId: string; canUpdate: boolean }) {
  const t = useTranslations('settings.users');
  const { resourceLabel, actionLabel } = useAclLabels();
  const [state, setState] = useState<Record<string, Override>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    usersApi
      .getPermissions(userId, controller.signal)
      .then((entries) => {
        const next: Record<string, Override> = {};
        for (const e of entries) {
          next[cellKey(e.resource, e.action)] = e.allowed ? 'allow' : 'deny';
        }
        setState(next);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(t('permsLoadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId]);

  function setCell(r: Resource, a: Action, value: Override) {
    setState((prev) => ({ ...prev, [cellKey(r, a)]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const entries: AclEntry[] = [];
    for (const r of RESOURCES) {
      for (const a of ACTIONS) {
        if (!isPermissionSupported(r, a)) continue;
        const v = state[cellKey(r, a)];
        if (v === 'allow') entries.push({ resource: r, action: a, allowed: true });
        else if (v === 'deny') entries.push({ resource: r, action: a, allowed: false });
      }
    }
    try {
      await usersApi.setPermissions(userId, entries);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center border-t border-border py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="border-t border-border p-4">
      <p className="mb-3 text-xs text-muted">{t('overridesHint')}</p>
      {error && <p className="mb-3 text-xs text-danger-600">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-muted">{t('resource')}</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-2 py-1.5 text-left text-xs font-medium text-muted">
                  {actionLabel(a)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((r) => (
              <tr key={r} className="border-t border-border">
                <td className="px-2 py-1.5 text-sm font-medium text-foreground">
                  {resourceLabel(r)}
                </td>
                {ACTIONS.map((a) => (
                  <td key={a} className="px-2 py-1.5">
                    {isPermissionSupported(r, a) ? (
                    <select
                      value={state[cellKey(r, a)] ?? 'inherit'}
                      onChange={(e) => setCell(r, a, e.target.value as Override)}
                      disabled={!canUpdate}
                      className="min-h-11 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground focus:border-accent-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                    >
                      <option value="inherit">{t('standard')}</option>
                      <option value="allow">{t('allowed')}</option>
                      <option value="deny">{t('denied')}</option>
                    </select>
                    ) : (
                      <span className="text-border" aria-hidden="true">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canUpdate && <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-70 cursor-pointer"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('saveOverrides')}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success-600">
            <Check className="h-3.5 w-3.5" /> {t('saved')}
          </span>
        )}
      </div>}
    </div>
  );
}
