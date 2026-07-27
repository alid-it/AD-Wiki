'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  X,
  AlertCircle,
  AlertTriangle,
  Check,
  BookOpen,
  NotebookPen,
  ShieldCheck,
} from 'lucide-react';
import { categories as categoriesApi, ApiClientError } from '@ad-wiki/api-client';
import type { CategoryScope, CategoryWithCount } from '@ad-wiki/shared-types';
import { ResourceAclButton } from '@/components/access/resource-acl-dialog';
import { useAuth } from '@/lib/auth-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

interface FormState {
  name: string;
  description: string;
  icon: string;
}
const EMPTY: FormState = { name: '', description: '', icon: '' };

export default function CategoriesSettingsPage() {
  const t = useTranslations('settings.categories');
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('categories', 'create');
  const canUpdate = hasPermission('categories', 'update');
  const canDelete = hasPermission('categories', 'delete');
  const [activeScope, setActiveScope] = useState<CategoryScope>('wiki');
  const [items, setItems] = useState<CategoryWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CategoryWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload(scope = activeScope) {
    try {
      setItems(await categoriesApi.list(undefined, scope));
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setEditingId(null);
    setForm(EMPTY);
    void reload(activeScope);
  }, [activeScope]);

  useEffect(() => {
    const reloadForAccessChange = () => void reload(activeScope);
    window.addEventListener(
      ACCESS_CONTROL_UPDATED_EVENT,
      reloadForAccessChange,
    );
    return () =>
      window.removeEventListener(
        ACCESS_CONTROL_UPDATED_EVENT,
        reloadForAccessChange,
      );
  }, [activeScope]);

  function startEdit(cat: CategoryWithCount) {
    setEditingId(cat.id);
    setForm({ name: cat.name, description: cat.description ?? '', icon: cat.icon ?? '' });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY);
  }

  async function submit() {
    if (!form.name.trim()) {
      setError(t('enterName'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        scope: activeScope,
        description: form.description.trim() || undefined,
        icon: form.icon.trim() || undefined,
      };
      if (editingId) {
        await categoriesApi.update(editingId, payload);
      } else {
        await categoriesApi.create(payload);
      }
      cancelEdit();
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  /** Tauscht die Sortierung mit dem Nachbarn und persistiert beide. */
  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const a = items[index];
    const b = items[target];
    setBusyId(a.id);
    // Optimistisch tauschen.
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    try {
      await Promise.all([
        categoriesApi.update(a.id, { sortOrder: b.sortOrder }),
        categoriesApi.update(b.id, { sortOrder: a.sortOrder }),
      ]);
      await reload();
    } catch {
      setError(t('sortFailed'));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await categoriesApi.remove(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1" role="tablist" aria-label={t('scopeLabel')}>
        {([
          { scope: 'wiki', icon: BookOpen },
          { scope: 'note', icon: NotebookPen },
          { scope: 'standard', icon: ShieldCheck },
        ] as const).map(({ scope, icon: Icon }) => (
          <button
            key={scope}
            type="button"
            role="tab"
            aria-selected={activeScope === scope}
            onClick={() => setActiveScope(scope)}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors cursor-pointer sm:flex-none ${
              activeScope === scope
                ? 'bg-accent-600 text-white'
                : 'text-muted hover:bg-background hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(`scope_${scope}`)}
          </button>
        ))}
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

      {/* Formular anlegen/bearbeiten */}
      {(canCreate || (canUpdate && editingId)) && <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-sm font-medium text-foreground">
          {editingId ? t('editCategory') : t('newCategory')}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input
            type="text"
            placeholder={t('name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputClass}
          />
          <input
            type="text"
            placeholder={t('descriptionOptional')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className={inputClass}
          />
          <input
            type="text"
            placeholder={t('iconOptional')}
            value={form.icon}
            onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-70 cursor-pointer"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editingId ? (
              <Check className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {editingId ? t('save') : t('create')}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
            >
              {t('cancel')}
            </button>
          )}
        </div>
      </div>}

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((cat, i) => (
            <li
              key={cat.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"
            >
              <div className="flex flex-col">
                {canUpdate && <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || busyId !== null}
                  aria-label={t('moveUp')}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>}
                {canUpdate && <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === items.length - 1 || busyId !== null}
                  aria-label={t('moveDown')}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{cat.name}</p>
                <p className="truncate text-xs text-muted">
                  {cat.description || t('noDescription')} ·{' '}
                  {t(
                    activeScope === 'note'
                      ? 'noteCount'
                      : activeScope === 'standard'
                        ? 'standardCount'
                        : 'pageCount',
                    { count: cat.contentCount },
                  )}
                </p>
              </div>

              <ResourceAclButton
                compact
                target={{
                  type: 'category',
                  id: cat.id,
                  label: cat.name,
                  resources: [
                    'categories',
                    activeScope === 'wiki'
                      ? 'pages'
                      : activeScope === 'note'
                        ? 'notes'
                        : 'standards',
                  ],
                }}
              />
              {canUpdate && <button
                type="button"
                onClick={() => startEdit(cat)}
                aria-label={t('edit')}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground cursor-pointer"
              >
                <Pencil className="h-4 w-4" />
              </button>}
              {canDelete && <button
                type="button"
                onClick={() => setDeleteTarget(cat)}
                aria-label={t('delete')}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-50 hover:text-danger-600 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
              </button>}
            </li>
          ))}
          {items.length === 0 && (
            <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
              {t('noCategories')}
            </li>
          )}
        </ul>
      )}

      {/* Lösch-Dialog mit Warnung */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={t('cancel')}
            onClick={() => !deleting && setDeleteTarget(null)}
            onKeyDown={(e) => e.key === 'Escape' && setDeleteTarget(null)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-soft-lg">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">{t('deleteTitle')}</h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                aria-label={t('close')}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-background cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {deleteTarget.contentCount > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2.5 text-sm text-warning-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('deleteWarning', { count: deleteTarget.contentCount })}</span>
              </div>
            )}
            <p className="mb-5 text-sm text-muted">{t('deleteText', { name: deleteTarget.name })}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-60 cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger-500 disabled:opacity-70 cursor-pointer"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
