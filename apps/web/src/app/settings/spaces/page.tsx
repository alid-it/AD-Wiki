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
  AlertTriangle,
  BookOpen,
  Check,
  FolderKanban,
  Loader2,
  LockKeyhole,
  NotebookPen,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  ApiClientError,
  groups as groupsApi,
  spaces as spacesApi,
} from '@ad-wiki/api-client';
import {
  CreateKnowledgeSpaceSchema,
  type GroupSummary,
  type KnowledgeKind,
  type KnowledgeSpace,
  type SpaceVisibility,
} from '@ad-wiki/shared-types';
import { ResourceAclButton } from '@/components/access/resource-acl-dialog';
import { useAuth } from '@/lib/auth-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

const fieldClass =
  'min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-foreground transition-colors duration-200 focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:bg-background disabled:opacity-60';

const secondaryButton =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50';

type SpaceDialog =
  | { mode: 'create' }
  | { mode: 'edit'; space: KnowledgeSpace };

const KIND_ICONS = {
  wiki: BookOpen,
  note: NotebookPen,
  standard: ShieldCheck,
} satisfies Record<KnowledgeKind, typeof BookOpen>;

export default function SpacesSettingsPage() {
  const t = useTranslations('settings.spaces');
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('spaces', 'create');
  const canUpdate = hasPermission('spaces', 'update');
  const canDelete = hasPermission('spaces', 'delete');
  const canReadGroups = hasPermission('groups', 'read');
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SpaceDialog | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [spaceItems, groupItems] = await Promise.all([
        spacesApi.list(),
        canReadGroups ? groupsApi.list() : Promise.resolve([]),
      ]);
      setSpaces(spaceItems);
      setGroups(groupItems);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [canReadGroups, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reloadForAccessChange = () => void load();
    window.addEventListener(
      ACCESS_CONTROL_UPDATED_EVENT,
      reloadForAccessChange,
    );
    return () =>
      window.removeEventListener(
        ACCESS_CONTROL_UPDATED_EVENT,
        reloadForAccessChange,
      );
  }, [load]);

  async function deleteSpace(space: KnowledgeSpace) {
    if (
      space.isSystem ||
      !window.confirm(t('deleteConfirm', { name: space.name }))
    ) {
      return;
    }
    setBusy(space.id);
    setError(null);
    try {
      await spacesApi.remove(space.id);
      await load();
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
          <p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p>
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

      <div className="rounded-xl border border-accent-200 bg-accent-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-700" />
          <div>
            <p className="text-sm font-semibold text-accent-800">
              {t('separationTitle')}
            </p>
            <p className="mt-1 text-xs leading-5 text-accent-700">
              {t('separationHint')}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {spaces.map((space) => (
          <article
            key={space.id}
            className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 sm:p-5"
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                  space.visibility === 'restricted'
                    ? 'bg-warning-50 text-warning-600'
                    : 'bg-success-50 text-success-600'
                }`}
              >
                {space.visibility === 'restricted' ? (
                  <LockKeyhole className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Unlock className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold text-foreground">
                    {space.name}
                  </h3>
                  {space.isSystem && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                      {t('systemSpace')}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      space.visibility === 'restricted'
                        ? 'bg-warning-50 text-warning-600'
                        : 'bg-success-50 text-success-600'
                    }`}
                  >
                    {t(`visibility_${space.visibility}`)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {space.description || t('noDescription')}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {space.enabledKinds.map((kind) => {
                const Icon = KIND_ICONS[kind];
                return (
                  <span
                    key={kind}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {t(`kind_${kind}`)}
                  </span>
                );
              })}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-background p-3 text-xs sm:grid-cols-4">
              <Count label={t('pages')} value={space.pageCount} />
              <Count label={t('categories')} value={space.categoryCount} />
              <Count label={t('notes')} value={space.noteCount} />
              <Count label={t('standards')} value={space.standardCount} />
            </dl>

            <div className="mt-4 min-w-0 text-xs text-muted">
              <span>{t('responsible')} </span>
              <span className="font-medium text-foreground">
                {space.responsibleGroup?.name ?? t('noResponsibleGroup')}
              </span>
            </div>

            <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-4">
              <ResourceAclButton
                target={{
                  type: 'space',
                  id: space.id,
                  label: space.name,
                  resources: [
                    'spaces',
                    'categories',
                    'pages',
                    'notes',
                    'standards',
                  ],
                }}
              />
              {canUpdate && (
                <button
                  type="button"
                  onClick={() => setDialog({ mode: 'edit', space })}
                  className={secondaryButton}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t('edit')}
                </button>
              )}
              {canDelete && !space.isSystem && (
                <button
                  type="button"
                  onClick={() => void deleteSpace(space)}
                  disabled={busy !== null}
                  className="ml-auto inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-danger-500/40 px-3 py-2 text-sm font-medium text-danger-600 transition-colors duration-200 hover:bg-danger-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === space.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('delete')}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {spaces.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-muted" />
          <p className="mt-3 text-sm font-semibold text-foreground">{t('empty')}</p>
        </div>
      )}

      {dialog && (
        <SpaceFormDialog
          dialog={dialog}
          groups={groups}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function SpaceFormDialog({
  dialog,
  groups,
  onClose,
  onSaved,
}: {
  dialog: SpaceDialog;
  groups: GroupSummary[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.spaces');
  const editing = dialog.mode === 'edit' ? dialog.space : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [visibility, setVisibility] = useState<SpaceVisibility>(
    editing?.visibility ?? 'open',
  );
  const [enabledKinds, setEnabledKinds] = useState<KnowledgeKind[]>(
    editing?.enabledKinds ?? ['wiki'],
  );
  const [responsibleGroupId, setResponsibleGroupId] = useState(
    editing?.responsibleGroupId ?? '',
  );
  const [restrictionConfirmed, setRestrictionConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activatesRestriction =
    visibility === 'restricted' && editing?.visibility !== 'restricted';

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  function toggleKind(kind: KnowledgeKind) {
    setEnabledKinds((current) =>
      current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enabledKinds.length === 0 || (activatesRestriction && !restrictionConfirmed)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        name,
        description: description || null,
        visibility,
        enabledKinds,
        responsibleGroupId: responsibleGroupId || null,
      };
      const parsed = CreateKnowledgeSpaceSchema.safeParse(input);
      if (!parsed.success) {
        setError(t('invalid'));
        return;
      }
      if (editing) {
        await spacesApi.update(editing.id, parsed.data);
      } else {
        await spacesApi.create(parsed.data);
      }
      await onSaved();
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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-dialog-title"
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-soft-lg sm:max-w-2xl sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="space-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {editing ? t('editTitle') : t('createTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted">{t('formHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t('close')}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-foreground">
            {t('name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={editing?.isSystem}
              required
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
              rows={3}
              maxLength={500}
              className={`mt-1.5 ${fieldClass}`}
            />
          </label>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">
              {t('visibility')}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([
                { value: 'open', icon: Unlock },
                { value: 'restricted', icon: LockKeyhole },
              ] as const).map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-200 ${
                    visibility === option.value
                      ? 'border-accent-300 bg-accent-50'
                      : 'border-border hover:bg-background'
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={visibility === option.value}
                    onChange={() => {
                      setVisibility(option.value);
                      setRestrictionConfirmed(false);
                    }}
                    className="mt-1 h-5 w-5 accent-accent-600"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <option.icon className="h-4 w-4" aria-hidden="true" />
                      {t(`visibility_${option.value}`)}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted">
                      {t(`visibility_${option.value}_hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {activatesRestriction && (
            <div className="rounded-xl border border-warning-500/40 bg-warning-50 p-4 text-warning-600">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">
                    {t('restrictionWarningTitle')}
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    {t('restrictionWarningHint')}
                  </p>
                </div>
              </div>
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-warning-500/30 bg-surface px-3 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={restrictionConfirmed}
                  onChange={(event) =>
                    setRestrictionConfirmed(event.target.checked)
                  }
                  className="h-5 w-5 accent-warning-600"
                />
                {t('restrictionConfirm')}
              </label>
            </div>
          )}

          <fieldset>
            <legend className="text-sm font-medium text-foreground">
              {t('enabledKinds')}
            </legend>
            <p className="mt-1 text-xs text-muted">{t('enabledKindsHint')}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(['wiki', 'note', 'standard'] as const).map((kind) => {
                const Icon = KIND_ICONS[kind];
                const selected = enabledKinds.includes(kind);
                return (
                  <label
                    key={kind}
                    className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors duration-200 ${
                      selected
                        ? 'border-accent-300 bg-accent-50 text-accent-700'
                        : 'border-border text-muted hover:text-foreground'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleKind(kind)}
                      className="h-5 w-5 accent-accent-600"
                    />
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t(`kind_${kind}`)}
                  </label>
                );
              })}
            </div>
            {enabledKinds.length === 0 && (
              <p role="alert" className="mt-2 text-xs text-danger-600">
                {t('kindRequired')}
              </p>
            )}
          </fieldset>

          <label className="text-sm font-medium text-foreground">
            {t('responsibleGroup')}
            <select
              value={responsibleGroupId}
              onChange={(event) => setResponsibleGroupId(event.target.value)}
              className={`mt-1.5 ${fieldClass}`}
            >
              <option value="">{t('noResponsibleGroup')}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs font-normal text-muted">
              {t('responsibleGroupHint')}
            </span>
          </label>

          {error && <ErrorMessage>{error}</ErrorMessage>}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={secondaryButton}
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={
                saving ||
                enabledKinds.length === 0 ||
                (activatesRestriction && !restrictionConfirmed)
              }
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
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
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
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
