'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  Bot,
  FileText,
  Inbox,
  Lightbulb,
  ListChecks,
  Loader2,
  LockKeyhole,
  NotebookPen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { categories, integrations, notes as notesApi, pages, ApiClientError } from '@ad-wiki/api-client';
import { SOCKET_EVENTS, type Note, type NoteChangedEvent, type NoteScope, type NoteStatus } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useSocketEvent } from '@/lib/socket-context';
import { useToast } from '@/components/ui/toast';
import { ArticleContent } from '@/components/content/article-content';
import { MarkdownEditor } from '@/components/editor/markdown-editor';
import { WysiwygEditor } from '@/components/editor/wysiwyg-editor';
import { isHtmlContent, toExcerpt } from '@/lib/content';
import type { WikiLinkTarget } from '@/lib/wiki-links';
import {
  KnowledgePageHeader,
  knowledgeHeaderPrimaryAction,
  knowledgeHeaderSecondaryAction,
} from '@/components/ui/knowledge-page-header';
import { ResourceAclButton } from '@/components/access/resource-acl-dialog';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

type Candidate = Awaited<ReturnType<typeof notesApi.shareCandidates>>[number];
type Category = Awaited<ReturnType<typeof categories.list>>[number];
type Scope = NoteScope | 'trash';

const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20';
const buttonSecondary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export default function NotesPage() {
  const t = useTranslations('notes');
  const toast = useToast();
  const { hasPermission, isLoading: authLoading } = useAuth();
  const canRead = hasPermission('notes', 'read');
  const canCreate = hasPermission('notes', 'create');
  const canUpdate = hasPermission('notes', 'update');
  const canDelete = hasPermission('notes', 'delete');
  const canShare = hasPermission('notes', 'share');
  const canCreatePage = hasPermission('pages', 'create');
  const canCreateStandard = hasPermission('standards', 'create');
  const canReadCategories = hasPermission('categories', 'read');
  const canExportToTodo = hasPermission('integrations', 'read') && hasPermission('integrations', 'update');

  const [items, setItems] = useState<Note[]>([]);
  const [categoryItems, setCategoryItems] = useState<Category[]>([]);
  const [scope, setScope] = useState<Scope>('all');
  const [status, setStatus] = useState<NoteStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [sharing, setSharing] = useState<Note | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const data = scope === 'trash'
        ? await notesApi.trash(signal)
        : await notesApi.list({ scope, status: status === 'all' ? undefined : status, q: query.trim() || undefined }, signal);
      setItems(data);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof ApiClientError ? err.message : t('loadFailed'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [canRead, query, scope, status, t]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, query]);

  useEffect(() => {
    if (!canReadCategories) return;
    const controller = new AbortController();
    categories.list(controller.signal, 'note').then(setCategoryItems).catch(() => undefined);
    return () => controller.abort();
  }, [canReadCategories]);

  useSocketEvent<NoteChangedEvent>(SOCKET_EVENTS.notesChanged, () => { void load(); });

  useEffect(() => {
    const reloadForAclChange = () => void load();
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAclChange);
    return () =>
      window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAclChange);
  }, [load]);

  useEffect(() => {
    if (canCreate && new URLSearchParams(window.location.search).get('new') === '1') setComposerOpen(true);
  }, [canCreate]);

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('note');
    if (!requestedId || !items.some((note) => note.id === requestedId)) return;
    requestAnimationFrame(() => document.getElementById(`note-${requestedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [items]);

  const knownTags = useMemo(() => [...new Set(items.flatMap((note) => note.tags))].sort(), [items]);
  const counts = useMemo(() => ({
    total: items.length,
    shared: items.filter((note) => !note.isOwner).length,
    mcp: items.filter((note) => note.mcpVisible).length,
  }), [items]);

  async function openShare(note: Note) {
    setSharing(note);
    if (candidates.length === 0) {
      try { setCandidates(await notesApi.shareCandidates()); } catch { toast.error(t('candidatesFailed')); }
    }
  }

  async function moveToTrash(note: Note) {
    if (!window.confirm(t('deleteConfirm', { title: note.title || t('untitled') }))) return;
    try { await notesApi.remove(note.id); toast.success(t('movedToTrash')); await load(); } catch { toast.error(t('deleteFailed')); }
  }

  async function restore(note: Note) {
    try { await notesApi.restore(note.id); toast.success(t('restored')); await load(); } catch { toast.error(t('restoreFailed')); }
  }

  async function permanentRemove(note: Note) {
    if (!window.confirm(t('permanentConfirm'))) return;
    const deleteExternal = window.confirm(t('permanentExternalConfirm'));
    try { await notesApi.permanentRemove(note.id, deleteExternal); toast.success(deleteExternal ? t('permanentlyDeletedWithTodo') : t('permanentlyDeleted')); await load(); } catch { toast.error(t('deleteFailed')); }
  }

  if (authLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  if (!canRead) return <div className="mx-auto max-w-5xl p-6"><div className="rounded-xl border border-border bg-surface p-10 text-center"><LockKeyhole className="mx-auto h-8 w-8 text-muted" /><h1 className="mt-3 text-lg font-semibold text-foreground">{t('noAccess')}</h1></div></div>;

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <KnowledgePageHeader
        icon={NotebookPen}
        title={t('title')}
        subtitle={t('subtitle')}
        iconClassName="bg-brand-50 text-brand-700"
        actions={<>
          <button type="button" onClick={() => setInboxOpen(true)} className={knowledgeHeaderSecondaryAction}><Inbox className="h-4 w-4" />{t('knowledgeInbox')}</button>
          {canCreate && <button type="button" onClick={() => setComposerOpen(true)} className={knowledgeHeaderPrimaryAction}><Plus className="h-4 w-4" />{t('quickNote')}</button>}
        </>}
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat icon={FileText} label={t('visibleNotes')} value={counts.total} />
        <Stat icon={Users} label={t('sharedWithMe')} value={counts.shared} />
        <Stat icon={Bot} label={t('mcpEnabled')} value={counts.mcp} />
      </div>

      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1">
          {(['all', 'mine', 'shared', 'trash'] as Scope[]).map((item) => <button key={item} type="button" onClick={() => setScope(item)} className={`min-h-9 rounded-lg px-3 text-sm font-medium transition-colors cursor-pointer ${scope === item ? 'bg-accent-600 text-white' : 'text-muted hover:bg-background hover:text-foreground'}`}>{t(`scope_${item}`)}</button>)}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {scope !== 'trash' && <select value={status} onChange={(event) => setStatus(event.target.value as NoteStatus | 'all')} className={`${fieldClass} sm:w-40`}><option value="all">{t('statusAll')}</option><option value="captured">{t('statusCaptured')}</option><option value="promoted">{t('statusPromoted')}</option><option value="archived">{t('statusArchived')}</option></select>}
          <label className="relative block sm:w-72"><span className="sr-only">{t('search')}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchPlaceholder')} className={`${fieldClass} pl-9`} /></label>
        </div>
      </div>

      {error && <div role="alert" className="mt-4 rounded-lg border border-danger-500/30 bg-danger-50 px-4 py-3 text-sm text-danger-600">{error}</div>}
      {loading ? <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : items.length === 0 ? <EmptyState canCreate={canCreate && scope !== 'trash'} onCreate={() => setComposerOpen(true)} trash={scope === 'trash'} /> : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((note) => <NoteCard key={note.id} note={note} trash={scope === 'trash'} canUpdate={canUpdate} canDelete={canDelete} canShare={canShare} canPromote={canCreatePage} onEdit={setEditing} onShare={(item) => void openShare(item)} onDelete={(item) => void moveToTrash(item)} onRestore={(item) => void restore(item)} onPermanent={(item) => void permanentRemove(item)} onChanged={() => void load()} onCheckboxChanged={(updated) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}
        </div>
      )}

      {composerOpen && <NoteEditorDialog mode="create" categories={categoryItems} knownTags={knownTags} canExportToTodo={canExportToTodo} onClose={() => setComposerOpen(false)} onSaved={() => { setComposerOpen(false); void load(); }} />}
      {editing && <NoteEditorDialog mode="edit" note={editing} categories={categoryItems} knownTags={knownTags} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {sharing && <ShareDialog note={sharing} candidates={candidates} onClose={() => setSharing(null)} onChanged={(note) => { setSharing(note); void load(); }} />}
      {inboxOpen && <KnowledgeInbox onClose={() => setInboxOpen(false)} onNote={() => { setInboxOpen(false); setComposerOpen(true); }} canCreatePage={canCreatePage} canCreateStandard={canCreateStandard} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: number }) {
  return <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-50 text-accent-700"><Icon className="h-5 w-5" /></span><div><p className="text-xl font-semibold text-foreground">{value}</p><p className="text-xs text-muted">{label}</p></div></div>;
}

function NoteCard({ note, trash, canUpdate, canDelete, canShare, canPromote, onEdit, onShare, onDelete, onRestore, onPermanent, onChanged, onCheckboxChanged }: { note: Note; trash: boolean; canUpdate: boolean; canDelete: boolean; canShare: boolean; canPromote: boolean; onEdit: (note: Note) => void; onShare: (note: Note) => void; onDelete: (note: Note) => void; onRestore: (note: Note) => void; onPermanent: (note: Note) => void; onChanged: () => void; onCheckboxChanged: (note: Note) => void }) {
  const t = useTranslations('notes');
  const toast = useToast();
  const editable = canUpdate && (note.isOwner || note.sharePermission === 'edit');
  async function promote() {
    if (!window.confirm(t('promoteConfirm'))) return;
    try { const page = await notesApi.promoteToWiki(note.id, { status: 'draft' }); toast.success(t('promoted')); onChanged(); window.location.assign(`/wiki/${page.slug}/edit`); } catch { toast.error(t('promoteFailed')); }
  }
  return <article id={`note-${note.id}`} className="flex min-h-72 scroll-mt-20 flex-col rounded-xl border border-border bg-surface p-4 transition-colors target:ring-2 target:ring-accent-500 hover:border-accent-300">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${note.status === 'captured' ? 'bg-accent-50 text-accent-700' : note.status === 'promoted' ? 'bg-success-50 text-success-600' : 'bg-background text-muted'}`}>{t(`status_${note.status}`)}</span>{note.mcpVisible && <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700"><Bot className="h-3 w-3" />MCP</span>}</div><h2 className="mt-3 truncate text-base font-semibold text-foreground">{note.title || t('untitled')}</h2></div>{!note.isOwner && <span title={t('sharedNote')}><Users className="h-4 w-4 text-accent-600" /></span>}</div>
    <div className="mt-3 max-h-40 overflow-hidden text-sm text-muted"><ArticleContent content={note.content} onCheckboxChange={editable && !trash ? async (checkboxIndex, checked) => { try { onCheckboxChanged(await notesApi.toggleCheckbox(note.id, { checkboxIndex, checked })); } catch (error) { toast.error(t('checklistUpdateFailed')); throw error; } } : undefined} /></div>
    <div className="mt-auto pt-4"><div className="flex flex-wrap gap-1.5">{note.category && <span className="rounded-full bg-background px-2 py-1 text-xs text-muted">{note.category.name}</span>}{note.tags.slice(0, 4).map((tag) => <span key={tag} className="rounded-full bg-accent-50 px-2 py-1 text-xs text-accent-700">#{tag}</span>)}</div><div className="mt-3 flex items-center justify-between border-t border-border pt-3"><div className="min-w-0 text-xs text-muted"><p className="truncate">{note.isOwner ? t('ownedByMe') : t('ownedBy', { name: note.owner.displayName })}</p><p>{new Date(note.updatedAt).toLocaleString()}</p></div><div className="flex items-center gap-1">{!trash && note.spaceId && <ResourceAclButton compact target={{ type: 'note', id: note.id, label: note.title || t('untitled'), resources: ['notes'] }} />}{trash ? <><button type="button" onClick={() => onRestore(note)} className="note-icon-button" title={t('restore')} aria-label={t('restore')}><RotateCcw className="h-4 w-4" /></button><button type="button" onClick={() => onPermanent(note)} className="note-icon-button text-danger-600" title={t('permanent')} aria-label={t('permanent')}><Trash2 className="h-4 w-4" /></button></> : <>{editable && <button type="button" onClick={() => onEdit(note)} className="note-icon-button" title={t('edit')} aria-label={t('edit')}><Pencil className="h-4 w-4" /></button>}{note.isOwner && canShare && <button type="button" onClick={() => onShare(note)} className="note-icon-button" title={t('share')} aria-label={t('share')}><Share2 className="h-4 w-4" /></button>}{note.isOwner && canUpdate && canPromote && note.status !== 'promoted' && <button type="button" onClick={() => void promote()} className="note-icon-button" title={t('promoteToWiki')} aria-label={t('promoteToWiki')}><BookOpen className="h-4 w-4" /></button>}{note.isOwner && canDelete && <button type="button" onClick={() => onDelete(note)} className="note-icon-button text-danger-600" title={t('delete')} aria-label={t('delete')}><Trash2 className="h-4 w-4" /></button>}</>}</div></div></div>
  </article>;
}

function EmptyState({ canCreate, onCreate, trash }: { canCreate: boolean; onCreate: () => void; trash: boolean }) {
  const t = useTranslations('notes');
  return <div className="mt-5 rounded-xl border border-dashed border-border bg-surface px-6 py-20 text-center"><NotebookPen className="mx-auto h-9 w-9 text-muted" /><h2 className="mt-3 text-base font-semibold text-foreground">{trash ? t('trashEmpty') : t('empty')}</h2><p className="mt-1 text-sm text-muted">{trash ? t('trashEmptyHint') : t('emptyHint')}</p>{canCreate && <button type="button" onClick={onCreate} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white cursor-pointer"><Plus className="h-4 w-4" />{t('quickNote')}</button>}</div>;
}

function NoteEditorDialog({ mode, note, categories, knownTags, canExportToTodo = false, onClose, onSaved }: { mode: 'create' | 'edit'; note?: Note; categories: Category[]; knownTags: string[]; canExportToTodo?: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('notes');
  const toast = useToast();
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [categoryId, setCategoryId] = useState(note?.categoryId ?? '');
  const [tags, setTags] = useState(note?.tags.join(', ') ?? '');
  const [status, setStatus] = useState<NoteStatus>(note?.status ?? 'captured');
  const [mcpVisible, setMcpVisible] = useState(note?.mcpVisible ?? false);
  const [saving, setSaving] = useState(false);
  const [todoLists, setTodoLists] = useState<Awaited<ReturnType<typeof integrations.lists>>>([]);
  const [todoListId, setTodoListId] = useState('');
  const [todoLoading, setTodoLoading] = useState(mode === 'create' && canExportToTodo);
  const [todoConnected, setTodoConnected] = useState(false);
  const [wikiPages, setWikiPages] = useState<WikiLinkTarget[]>([]);
  const isOwner = note?.isOwner ?? true;
  const editorType = note && !isHtmlContent(note.content) ? 'markdown' : 'wysiwyg';

  useEffect(() => {
    const controller = new AbortController();
    pages.list({ page: 1, perPage: 100 }, controller.signal)
      .then((result) => setWikiPages(result.data.filter((page) => page.type === 'page').map(({ id, title, slug }) => ({ id, title, slug }))))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode !== 'create' || !canExportToTodo) return;
    const controller = new AbortController();
    integrations.status(controller.signal).then(async (connection) => {
      if (!connection.connected || connection.status !== 'active') return;
      setTodoConnected(true);
      const selectedLists = (await integrations.lists(controller.signal)).filter((list) => list.selected);
      setTodoLists(selectedLists);
      if (selectedLists.length === 1) setTodoListId(selectedLists[0].id);
    }).catch(() => undefined).finally(() => {
      if (!controller.signal.aborted) setTodoLoading(false);
    });
    return () => controller.abort();
  }, [canExportToTodo, mode]);

  async function save() {
    if (!toExcerpt(content).trim()) { toast.error(t('contentRequired')); return; }
    setSaving(true);
    const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    try {
      if (mode === 'create') {
        const created = await notesApi.create({ title: title.trim() || null, content: content.trim(), categoryId: categoryId || null, tags: tagList, mcpVisible });
        if (todoListId) {
          try {
            await integrations.createTask({ noteId: created.id, listId: todoListId });
            toast.success(t('createdAndTodo'));
          } catch {
            toast.error(t('createdTodoFailed'));
          }
          onSaved();
          return;
        }
      } else if (note) {
        await notesApi.update(note.id, { title: title.trim() || null, content: content.trim(), categoryId: categoryId || null, tags: tagList, ...(isOwner ? { status, mcpVisible } : {}) });
      }
      toast.success(mode === 'create' ? t('created') : t('saved'));
      onSaved();
    } catch { toast.error(t('saveFailed')); setSaving(false); }
  }
  return <Dialog title={mode === 'create' ? t('newNote') : t('editNote')} onClose={onClose} wide><div className="grid gap-4"><label className="text-sm font-medium text-foreground">{t('titleOptional')}<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder={t('titlePlaceholder')} className={`mt-1 ${fieldClass}`} /></label><div><div className="mb-1 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-foreground">{t('content')}</p><span className="rounded-full bg-background px-2 py-1 text-[11px] font-semibold text-muted">{t(editorType === 'wysiwyg' ? 'visualEditor' : 'markdownEditor')}</span></div>{editorType === 'wysiwyg' ? <WysiwygEditor value={content} onChange={setContent} wikiPages={wikiPages} /> : <><MarkdownEditor value={content} onChange={setContent} wikiPages={wikiPages} /><p className="mt-1 text-xs text-muted">{t('legacyMarkdownHint')}</p></>}</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-foreground">{t('category')}<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={`mt-1 ${fieldClass}`}><option value="">{t('noCategory')}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{mode === 'edit' && isOwner && <label className="text-sm font-medium text-foreground">{t('status')}<select value={status} onChange={(event) => setStatus(event.target.value as NoteStatus)} className={`mt-1 ${fieldClass}`}><option value="captured">{t('statusCaptured')}</option><option value="promoted">{t('statusPromoted')}</option><option value="archived">{t('statusArchived')}</option></select></label>}</div><label className="text-sm font-medium text-foreground">{t('tags')}<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t('tagsPlaceholder')} className={`mt-1 ${fieldClass}`} /></label>{knownTags.length > 0 && <div><p className="mb-2 text-xs font-medium text-muted">{t('knownTags')}</p><div className="flex flex-wrap gap-2">{knownTags.slice(0, 12).map((tag) => <button key={tag} type="button" onClick={() => setTags((value) => [...value.split(',').map((item) => item.trim()).filter(Boolean), tag].filter((item, index, all) => all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index).join(', '))} className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:bg-background cursor-pointer">{tag}</button>)}</div></div>}{mode === 'create' && canExportToTodo && <div className="rounded-lg border border-border bg-background p-3"><div className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-brand-600" /><p className="text-sm font-medium text-foreground">{t('todoTitle')}</p></div>{todoLoading ? <p className="mt-2 text-xs text-muted">{t('todoLoading')}</p> : todoConnected && todoLists.length > 0 ? <label className="mt-3 block text-sm text-foreground">{t('todoListOptional')}<select value={todoListId} onChange={(event) => setTodoListId(event.target.value)} className={`mt-1 ${fieldClass}`}><option value="">{t('todoNone')}</option>{todoLists.map((list) => <option key={list.id} value={list.id}>{list.displayName}</option>)}</select><span className="mt-1 block text-xs text-muted">{t('todoHint')}</span></label> : <p className="mt-2 text-xs text-muted">{todoConnected ? t('todoNoSelected') : t('todoNotConnected')} <Link href="/settings/integrations" className="font-semibold text-accent-700 hover:underline">{t('todoConfigure')}</Link></p>}</div>}{isOwner && <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-background px-3 text-sm text-foreground cursor-pointer"><input type="checkbox" checked={mcpVisible} onChange={(event) => setMcpVisible(event.target.checked)} className="h-4 w-4 accent-accent-600" /><span><span className="font-medium">{t('mcpVisible')}</span><span className="block text-xs text-muted">{t('mcpHint')}</span></span></label>}<div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className={buttonSecondary}>{t('cancel')}</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? t('saving') : t('save')}</button></div></div></Dialog>;
}

function ShareDialog({ note, candidates, onClose, onChanged }: { note: Note; candidates: Candidate[]; onClose: () => void; onChanged: (note: Note) => void }) {
  const t = useTranslations('notes');
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [saving, setSaving] = useState(false);
  const available = candidates.filter((candidate) => !note.shares.some((share) => share.user.id === candidate.id));
  async function add() { if (!userId) return; setSaving(true); try { onChanged(await notesApi.share(note.id, { userId, permission })); setUserId(''); toast.success(t('shared')); } catch { toast.error(t('shareFailed')); } finally { setSaving(false); } }
  async function remove(target: string) { try { onChanged(await notesApi.unshare(note.id, target)); toast.success(t('shareRemoved')); } catch { toast.error(t('shareFailed')); } }
  return <Dialog title={t('shareTitle', { title: note.title || t('untitled') })} onClose={onClose}><div className="space-y-4"><div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]"><select value={userId} onChange={(event) => setUserId(event.target.value)} className={fieldClass}><option value="">{t('selectUser')}</option>{available.map((user) => <option key={user.id} value={user.id}>{user.displayName} ({user.email})</option>)}</select><select value={permission} onChange={(event) => setPermission(event.target.value as 'view' | 'edit')} className={fieldClass}><option value="view">{t('permissionView')}</option><option value="edit">{t('permissionEdit')}</option></select><button type="button" onClick={() => void add()} disabled={!userId || saving} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-accent-600 px-3 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer">{t('add')}</button></div><div className="border-t border-border pt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('sharedUsers')}</h3>{note.shares.length === 0 ? <p className="mt-3 text-sm text-muted">{t('notShared')}</p> : <ul className="mt-2 space-y-2">{note.shares.map((share) => <li key={share.user.id} className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{share.user.displayName}</p><p className="truncate text-xs text-muted">{share.user.email} · {t(`permission_${share.permission}`)}</p></div><button type="button" onClick={() => void remove(share.user.id)} className="note-icon-button text-danger-600" aria-label={t('removeShare')} title={t('removeShare')}><X className="h-4 w-4" /></button></li>)}</ul>}</div></div></Dialog>;
}

function KnowledgeInbox({ onClose, onNote, canCreatePage, canCreateStandard }: { onClose: () => void; onNote: () => void; canCreatePage: boolean; canCreateStandard: boolean }) {
  const t = useTranslations('notes');
  return <Dialog title={t('inboxTitle')} onClose={onClose} wide><p className="text-sm text-muted">{t('inboxHint')}</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><button type="button" onClick={onNote} className="knowledge-choice"><NotebookPen className="h-6 w-6 text-accent-600" /><span className="font-semibold text-foreground">{t('kindNote')}</span><span className="text-xs text-muted">{t('kindNoteHint')}</span></button>{canCreatePage ? <Link href="/wiki/new" className="knowledge-choice"><BookOpen className="h-6 w-6 text-success-600" /><span className="font-semibold text-foreground">{t('kindWiki')}</span><span className="text-xs text-muted">{t('kindWikiHint')}</span></Link> : <div className="knowledge-choice opacity-50"><BookOpen className="h-6 w-6 text-success-600" /><span className="font-semibold text-foreground">{t('kindWiki')}</span><span className="text-xs text-muted">{t('noPermission')}</span></div>}{canCreateStandard ? <Link href="/standards" className="knowledge-choice"><Sparkles className="h-6 w-6 text-brand-600" /><span className="font-semibold text-foreground">{t('kindStandard')}</span><span className="text-xs text-muted">{t('kindStandardHint')}</span></Link> : <div className="knowledge-choice opacity-50"><Sparkles className="h-6 w-6 text-brand-600" /><span className="font-semibold text-foreground">{t('kindStandard')}</span><span className="text-xs text-muted">{t('noPermission')}</span></div>}</div><div className="mt-5 flex items-start gap-3 rounded-lg border border-accent-200 bg-accent-50 p-3"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent-700" /><p className="text-xs leading-5 text-accent-700">{t('aiPreparation')}</p></div></Dialog>;
}

function Dialog({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-surface p-5 shadow-soft-lg ${wide ? 'max-w-3xl' : 'max-w-xl'}`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-foreground">{title}</h2><button type="button" onClick={onClose} className="note-icon-button" aria-label="Close"><X className="h-5 w-5" /></button></div>{children}</div></div>;
}
