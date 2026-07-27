'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Loader2, Save, X, AlertCircle, Tag, Plus } from 'lucide-react';
import { pages, ApiClientError } from '@ad-wiki/api-client';
import type { PageStatus } from '@ad-wiki/shared-types';
import type { WikiLinkTarget } from '@/lib/wiki-links';
import { toExcerpt } from '@/lib/content';
import { MarkdownEditor } from '@/components/editor/markdown-editor';
import { WysiwygEditor } from '@/components/editor/wysiwyg-editor';

export type EditorType = 'markdown' | 'wysiwyg';

interface PageEditorFormProps {
  mode: 'create' | 'edit';
  editorType: EditorType;
  initialTitle: string;
  initialContent: string;
  initialStatus: PageStatus;
  initialIsPublic?: boolean;
  initialMcpVisible?: boolean;
  initialTags?: string[];
  /** Nur im Create-Modus benötigt. */
  createMeta?: { categoryId: string | null; parentId: string | null };
  /** Nur im Edit-Modus benötigt. */
  pageId?: string;
  /** Ziel für „Abbrechen" bzw. nach dem Speichern im Edit-Modus. */
  cancelHref: string;
}

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20';

/**
 * Normalisiert Inhalt für den Vergleich: Windows-Zeilenumbrüche (\r\n) auf \n
 * vereinheitlichen und umschließenden Whitespace entfernen. So gilt reiner
 * Whitespace-Unterschied nicht als echte Änderung.
 */
function normalizeContent(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

const STATUS_KEYS: Record<PageStatus, 'statusDraft' | 'statusPublished' | 'statusArchived'> = {
  draft: 'statusDraft',
  published: 'statusPublished',
  archived: 'statusArchived',
};

/**
 * Formular-Hülle um die eigentlichen Editoren. Kümmert sich um Titel, Status,
 * optionale Änderungsnotiz sowie das Speichern (create/update) und die Navigation.
 */
export function PageEditorForm({
  mode,
  editorType,
  initialTitle,
  initialContent,
  initialStatus,
  initialIsPublic = false,
  initialMcpVisible = false,
  initialTags = [],
  createMeta,
  pageId,
  cancelHref,
}: PageEditorFormProps) {
  const router = useRouter();
  const t = useTranslations('editor');
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<PageStatus>(initialStatus);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [mcpVisible, setMcpVisible] = useState(initialMcpVisible);
  const [changeMessage, setChangeMessage] = useState('');
  const [tags, setTags] = useState<string[]>(initialTags);
  const [tagInput, setTagInput] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [wikiPages, setWikiPages] = useState<WikiLinkTarget[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autosaveAt, setAutosaveAt] = useState<number | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [restoreAvailable, setRestoreAvailable] = useState<{ title: string; content: string; status: PageStatus; isPublic?: boolean; mcpVisible?: boolean; tags: string[]; savedAt: number } | null>(null);
  const dirty = useRef(false);
  const initialized = useRef(false);
  // Letzter bekannter DB-Stand – Vergleichsbasis, ob es echte Änderungen gibt.
  const baselineRef = useRef({ title: initialTitle, content: initialContent });
  const autosaveKey = `autosave:${mode === 'edit' ? pageId : 'new'}`;

  /** Prüft, ob sich Titel oder Inhalt gegenüber dem DB-Stand echt unterscheiden. */
  const hasRealChanges = useCallback(
    (nextTitle: string, nextContent: string) =>
      normalizeContent(nextContent) !== normalizeContent(baselineRef.current.content) ||
      nextTitle.trim() !== baselineRef.current.title.trim(),
    [],
  );

  // Bestehende Seiten speichern den Entwurf pro Benutzer in der DB, noch nicht
  // erstellte neue Seiten weiterhin lokal (localStorage), da es keine pageId gibt.
  const useDbDraft = mode === 'edit' && !!pageId;

  /** Entwurf persistieren; liefert den Speicherzeitpunkt (ms) zurück. */
  const persistDraft = useCallback(
    async (draft: { title: string; content: string; status: PageStatus; isPublic: boolean; mcpVisible: boolean; tags: string[] }) => {
      if (useDbDraft && pageId) {
        const saved = await pages.saveDraft(pageId, draft);
        return Date.parse(saved.updatedAt);
      }
      const savedAt = Date.now();
      localStorage.setItem(autosaveKey, JSON.stringify({ ...draft, savedAt }));
      return savedAt;
    },
    [useDbDraft, pageId, autosaveKey],
  );

  /** Entwurf verwerfen (DB oder localStorage). Fehler bewusst still. */
  const clearDraft = useCallback(async () => {
    if (useDbDraft && pageId) { await pages.deleteDraft(pageId).catch(() => undefined); return; }
    localStorage.removeItem(autosaveKey);
  }, [useDbDraft, pageId, autosaveKey]);

  // Beim Laden: Entwurf nur anbieten, wenn er sich wirklich vom aktuellen
  // DB-Stand unterscheidet – sonst still verwerfen (kein Banner).
  useEffect(() => {
    const controller = new AbortController();
    type LoadedDraft = { title: string; content: string; status: PageStatus; isPublic?: boolean; mcpVisible?: boolean; tags: string[] };
    const offerDraft = (draft: LoadedDraft, savedAt: number) => {
      if (hasRealChanges(draft.title, draft.content)) {
        setRestoreAvailable({ title: draft.title, content: draft.content, status: draft.status, isPublic: draft.isPublic, mcpVisible: draft.mcpVisible, tags: draft.tags, savedAt });
      } else {
        void clearDraft();
      }
    };
    if (useDbDraft && pageId) {
      pages.getDraft(pageId, controller.signal).then((draft) => { if (draft) offerDraft(draft, Date.parse(draft.updatedAt)); }).catch(() => undefined);
    } else {
      try {
        const saved = localStorage.getItem(autosaveKey);
        if (saved) { const draft = JSON.parse(saved) as LoadedDraft & { savedAt: number }; offerDraft(draft, draft.savedAt); }
      } catch { localStorage.removeItem(autosaveKey); }
    }
    return () => controller.abort();
  }, [autosaveKey, hasRealChanges, useDbDraft, pageId, clearDraft]);

  // Debounced Autosave: erst 30 s nach der letzten echten Änderung schreiben.
  // Ohne echte Abweichung vom DB-Stand wird nichts gespeichert.
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    if (!hasRealChanges(title, content)) {
      // Zurück auf DB-Stand → evtl. vorhandenen Entwurf verwerfen.
      dirty.current = false;
      void clearDraft();
      setAutosaveAt(null);
      return;
    }
    dirty.current = true;
    // Fast unmittelbar nach dem Tippen speichern: kurzer Debounce (800 ms), damit
    // nicht bei jedem einzelnen Tastendruck ein Request rausgeht, es sich aber
    // trotzdem sofort anfühlt.
    const timer = window.setTimeout(() => {
      setDraftSaving(true);
      persistDraft({ title, content, status, isPublic, mcpVisible, tags })
        .then((savedAt) => setAutosaveAt(savedAt))
        .catch(() => undefined)
        .finally(() => setDraftSaving(false));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [title, content, status, isPublic, mcpVisible, tags, hasRealChanges, persistDraft, clearDraft]);

  // Warnung nur, wenn es tatsächlich ungespeicherte Änderungen gibt.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([pages.tags(controller.signal), pages.list({ page: 1, perPage: 100 }, controller.signal)]).then(([tags, result]) => { setKnownTags(tags); setWikiPages(result.data.filter((page) => page.type === 'page').map(({ id, title, slug }) => ({ id, title, slug }))); }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  function addTag(value = tagInput) {
    const additions = value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    setTags((current) => {
      const next = [...current];
      for (const tag of additions) {
        if (tag.length <= 40 && !next.some((item) => item.toLowerCase() === tag.toLowerCase())) {
          next.push(tag);
        }
        if (next.length === 20) break;
      }
      return next;
    });
    setTagInput('');
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag();
    }
    if (event.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags((current) => current.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((item) => item !== tag));
  }

  async function handleSave() {
    if (!title.trim()) {
      setError(t('enterTitle'));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (mode === 'create') {
        if (!createMeta) throw new Error('createMeta fehlt.');
        const excerpt = toExcerpt(content);
        const created = await pages.create({
          title: title.trim(),
          type: 'page',
          content,
          excerpt: excerpt || undefined,
          status,
          isPublic,
          mcpVisible,
          categoryId: createMeta.categoryId,
          parentId: createMeta.parentId,
          tags,
        });
        router.push(`/wiki/${created.slug}`);
      } else {
        if (!pageId) throw new Error('pageId fehlt.');
        await pages.update(pageId, {
          title: title.trim(),
          content,
          status,
          isPublic,
          mcpVisible,
          tags,
          changeMessage: changeMessage.trim() || undefined,
        });
        router.push(cancelHref);
      }
      // Neuer DB-Stand wird zur Vergleichsbasis für den nächsten Autosave-Zyklus.
      baselineRef.current = { title: title.trim(), content };
      await clearDraft();
      dirty.current = false;
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('saveFailed'));
      setSaving(false);
    }
  }

  // Anzeige: gerade am Speichern → danach der absolute Zeitpunkt der letzten
  // Entwurfsspeicherung, sonst der neutrale Ruhezustand.
  const autosaveLabel = draftSaving
    ? t('autosaveSaving')
    : autosaveAt
      ? t('autosaveSavedAt', { time: new Date(autosaveAt).toLocaleTimeString() })
      : t('autosaveIdle');

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      {restoreAvailable && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2.5 text-sm text-foreground"><span>{t('autosaveRestore', { date: new Date(restoreAvailable.savedAt).toLocaleString() })}</span><span className="flex gap-2"><button type="button" onClick={() => { setTitle(restoreAvailable.title); setContent(restoreAvailable.content); setStatus(restoreAvailable.status); setIsPublic(restoreAvailable.isPublic ?? false); setMcpVisible(restoreAvailable.mcpVisible ?? false); setTags(restoreAvailable.tags); setRestoreAvailable(null); }} className="font-semibold text-accent-700 cursor-pointer">{t('restore')}</button><button type="button" onClick={() => { void clearDraft(); setRestoreAvailable(null); }} className="font-medium text-muted cursor-pointer">{t('discard')}</button></span></div>}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Titel + diskreter Autosave-Status */}
      <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('titlePlaceholder')}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight text-foreground placeholder:text-muted focus:outline-none"
        />
        <span aria-live="polite" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
          <span className={`h-2 w-2 rounded-full ${draftSaving ? 'animate-pulse bg-warning-500' : autosaveAt ? 'bg-success-500' : 'bg-muted'}`} />
          {autosaveLabel}
        </span>
      </div>

      {/* Editor */}
      {editorType === 'markdown' ? (
        <MarkdownEditor value={content} onChange={setContent} wikiPages={wikiPages} pageId={pageId} />
      ) : (
        <WysiwygEditor value={content} onChange={setContent} wikiPages={wikiPages} pageId={pageId} />
      )}

      {/* Tags */}
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <label htmlFor="page-tags" className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Tag className="h-4 w-4 text-muted" />
          {t('tags')}
        </label>
        <p className="mt-1 text-xs text-muted">{t('tagsHint')}</p>

        <div className="mt-3 flex min-h-11 flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:border-accent-600 focus-within:ring-2 focus-within:ring-accent-600/20">
          {tags.map((tag) => (
            <span
              key={tag.toLowerCase()}
              className="inline-flex min-h-8 items-center gap-1 rounded-full bg-accent-50 pl-3 pr-1 text-xs font-medium text-accent-700"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={t('removeTag', { tag })}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-accent-100 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <input
            id="page-tags"
            type="text"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => tagInput.trim() && addTag()}
            maxLength={40}
            disabled={tags.length >= 20}
            placeholder={tags.length === 0 ? t('tagsPlaceholderEmpty') : t('tagsPlaceholderMore')}
            className="min-h-8 min-w-44 flex-1 border-0 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
        </div>

        {knownTags.some(
          (known) => !tags.some((selected) => selected.toLowerCase() === known.toLowerCase()),
        ) && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-muted">{t('knownTags')}</p>
            <div className="flex flex-wrap gap-2">
              {knownTags
                .filter(
                  (known) =>
                    !tags.some((selected) => selected.toLowerCase() === known.toLowerCase()),
                )
                .map((known) => (
                  <button
                    key={known}
                    type="button"
                    onClick={() => addTag(known)}
                    disabled={tags.length >= 20}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-muted transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" /> {known}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Aktionsleiste */}
      <div className="mt-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status" className="text-xs font-medium text-muted">
              {t('status')}
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PageStatus)}
              className={`${inputClass} sm:w-44`}
            >
              {(Object.keys(STATUS_KEYS) as PageStatus[]).map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_KEYS[s])}
                </option>
              ))}
            </select>
          </div>

          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground cursor-pointer">
            <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} className="h-4 w-4 accent-accent-600" />
            <span>{t('publicPage')}</span>
          </label>

          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground cursor-pointer">
            <input type="checkbox" checked={mcpVisible} onChange={(event) => setMcpVisible(event.target.checked)} className="h-4 w-4 accent-accent-600" />
            <span>{t('mcpVisible')}</span>
          </label>

          {mode === 'edit' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="changeMessage" className="text-xs font-medium text-muted">
                {t('changeMessage')}
              </label>
              <input
                id="changeMessage"
                type="text"
                value={changeMessage}
                onChange={(e) => setChangeMessage(e.target.value)}
                placeholder={t('changeMessagePlaceholder')}
                className={`${inputClass} sm:w-64`}
              />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Link
            href={cancelHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
          >
            <X className="h-4 w-4" />
            {t('cancel')}
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
