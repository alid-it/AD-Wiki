'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  FileText,
  Folder,
  Code,
  Wand2,
  ArrowRight,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';
import { categories as categoriesApi, pages as pagesApi, ApiClientError } from '@ad-wiki/api-client';
import type { CategoryWithCount, Page } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { PageEditorForm, type EditorType } from '@/components/editor/page-editor-form';

type PageType = 'page' | 'folder';

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground transition-colors focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

export default function NewPageWizard() {
  const router = useRouter();
  const t = useTranslations('editor.new');
  const { user } = useAuth();

  const [step, setStep] = useState<'select' | 'edit'>('select');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<PageType>('page');
  const [categoryId, setCategoryId] = useState('');
  const [parentId, setParentId] = useState('');
  const [editorType, setEditorType] = useState<EditorType>('markdown');

  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [parents, setParents] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [cats, list] = await Promise.all([
          categoriesApi.list(controller.signal),
          pagesApi.list({ page: 1, perPage: 100 }, controller.signal),
        ]);
        setCategories(cats);
        setParents(list.data);
      } catch {
        // Dropdowns bleiben leer – Seite ist trotzdem nutzbar.
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function handleCreate() {
    if (!title.trim()) {
      setError(t('enterTitle'));
      return;
    }
    if (!user) {
      setError(t('notLoggedIn'));
      return;
    }
    setError(null);

    // Seiten öffnen den Editor; Ordner werden direkt angelegt.
    if (type === 'page') {
      setStep('edit');
      return;
    }

    setSubmitting(true);
    try {
      await pagesApi.create({
        title: title.trim(),
        type: 'folder',
        content: '',
        status: 'published',
        isPublic: false,
        mcpVisible: false,
        categoryId: categoryId || null,
        parentId: parentId || null,
        tags: [],
      });
      router.push('/wiki');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('folderCreateFailed'));
      setSubmitting(false);
    }
  }

  // Schritt 2: Editor
  if (step === 'edit' && user) {
    return (
      <PageEditorForm
        mode="create"
        editorType={editorType}
        initialTitle={title.trim()}
        initialContent=""
        initialStatus="draft"
        createMeta={{
          categoryId: categoryId || null,
          parentId: parentId || null,
        }}
        cancelHref="/wiki"
      />
    );
  }

  // Schritt 1: Auswahl
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 sm:p-6">
        {/* Titel */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="text-sm font-medium text-foreground">
            {t('titleLabel')}
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('titlePlaceholder')}
            className={inputClass}
            autoFocus
          />
        </div>

        {/* Typ */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t('type')}</span>
          <div className="grid grid-cols-2 gap-2">
            <TypeOption
              active={type === 'page'}
              onClick={() => setType('page')}
              icon={<FileText className="h-4 w-4" />}
              label={t('typePage')}
              hint={t('typePageHint')}
            />
            <TypeOption
              active={type === 'folder'}
              onClick={() => setType('folder')}
              icon={<Folder className="h-4 w-4" />}
              label={t('typeFolder')}
              hint={t('typeFolderHint')}
            />
          </div>
        </div>

        {/* Kategorie + Parent */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="category" className="text-sm font-medium text-foreground">
              {t('category')}
            </label>
            <select
              id="category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={inputClass}
              disabled={loading}
            >
              <option value="">{t('none')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="parent" className="text-sm font-medium text-foreground">
              {t('parentPage')}
            </label>
            <select
              id="parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={inputClass}
              disabled={loading}
            >
              <option value="">{t('none')}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Editor-Auswahl (nur für Seiten) */}
        {type === 'page' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">{t('editorLabel')}</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EditorCard
                active={editorType === 'markdown'}
                onClick={() => setEditorType('markdown')}
                icon={<Code className="h-6 w-6" />}
                title={t('markdownTitle')}
                description={t('markdownDesc')}
              />
              <EditorCard
                active={editorType === 'wysiwyg'}
                onClick={() => setEditorType('wysiwyg')}
                icon={<Wand2 className="h-6 w-6" />}
                title={t('wysiwygTitle')}
                description={t('wysiwygDesc')}
              />
            </div>
          </div>
        )}

        {/* Aktion */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Link
            href="/wiki"
            className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
          >
            {t('cancel')}
          </Link>
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-soft-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {type === 'page' ? t('continueToEditor') : t('createFolder')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeOption({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors cursor-pointer ${
        active
          ? 'border-accent-600 bg-accent-50'
          : 'border-border bg-surface hover:border-accent-300'
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-md ${
          active ? 'bg-accent-600 text-white' : 'bg-background text-muted'
        }`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  );
}

function EditorCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all cursor-pointer ${
        active
          ? 'border-accent-600 bg-accent-50 shadow-soft-sm'
          : 'border-border bg-surface hover:border-accent-300 hover:shadow-soft-sm'
      }`}
    >
      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 text-white">
          <Check className="h-3 w-3" />
        </span>
      )}
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-lg ${
          active ? 'bg-accent-600 text-white' : 'bg-background text-accent-600'
        }`}
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted">{description}</span>
      </span>
    </button>
  );
}
