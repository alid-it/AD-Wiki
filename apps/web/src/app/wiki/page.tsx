'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Plus, FileText, Loader2, Upload, Trash2, FileUp, Folder, FolderTree, Network, BookOpen } from 'lucide-react';
import { categories as categoriesApi, pages as pagesApi, wikiExport } from '@ad-wiki/api-client';
import type { CategoryWithCount, Page, PageStatus } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';
import { SOCKET_EVENTS, type WikiNotification } from '@ad-wiki/shared-types';
import { useSocketEvent } from '@/lib/socket-context';
import {
  KnowledgePageHeader,
  knowledgeHeaderIconAction,
  knowledgeHeaderPrimaryAction,
  knowledgeHeaderSecondaryAction,
} from '@/components/ui/knowledge-page-header';
import { ExportMenu } from '@/components/content/export-menu';
import { saveDownload } from '@/lib/download';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

type Filter = 'all' | PageStatus;
type ViewMode = 'overview' | 'toc';

const FILTERS: { key: Filter; labelKey: 'filterAll' | 'filterPublished' | 'filterDrafts' | 'filterArchived' }[] = [
  { key: 'all', labelKey: 'filterAll' },
  { key: 'published', labelKey: 'filterPublished' },
  { key: 'draft', labelKey: 'filterDrafts' },
  { key: 'archived', labelKey: 'filterArchived' },
];

const STATUS_BADGE: Record<
  PageStatus,
  { labelKey: 'statusPublished' | 'statusDraft' | 'statusArchived'; tone: string }
> = {
  published: { labelKey: 'statusPublished', tone: 'bg-success-50 text-success-600' },
  draft: { labelKey: 'statusDraft', tone: 'bg-warning-50 text-warning-600' },
  archived: { labelKey: 'statusArchived', tone: 'bg-background text-muted' },
};

export default function WikiOverviewPage() {
  const t = useTranslations('wiki');
  const { hasPermission } = useAuth();
  const canCreatePages = hasPermission('pages', 'create');
  const canManageTrash = hasPermission('pages', 'update');
  const canDeletePages = hasPermission('pages', 'delete');
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [items, setItems] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [importPreview, setImportPreview] = useState('');
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [folders, setFolders] = useState<Page[]>([]);
  const [importCategoryId, setImportCategoryId] = useState('');
  const [importParentId, setImportParentId] = useState('');
  const [importStatus, setImportStatus] = useState<PageStatus>('draft');
  const [importTags, setImportTags] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [importTitle, setImportTitle] = useState('');
  const [categorySlug, setCategorySlug] = useState<string | null>(null);
  const [exportingCategory, setExportingCategory] = useState<'pdf' | 'markdown' | null>(null);

  useEffect(() => {
    setCategorySlug(new URLSearchParams(window.location.search).get('category'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    pagesApi
      .list(
        { page: 1, perPage: 100, status: viewMode === 'toc' || filter === 'all' ? undefined : filter },
        controller.signal,
      )
      .then((res) => {
        // Nur echte Inhaltsseiten anzeigen, keine Ordner.
        setItems(res.data.filter((p) => p.type === 'page'));
        setFolders(res.data.filter((p) => p.type === 'folder'));
      })
      .catch(() => {
        /* Fehler → leere Liste. */
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [filter, viewMode]);

  useSocketEvent<WikiNotification>(SOCKET_EVENTS.notification, (notification) => {
    if (notification.resource === 'page') {
      void pagesApi.list({ page: 1, perPage: 100, status: viewMode === 'toc' || filter === 'all' ? undefined : filter })
        .then((res) => { setItems(res.data.filter((page) => page.type === 'page')); setFolders(res.data.filter((page) => page.type === 'folder')); })
        .catch(() => undefined);
    }
  });

  useEffect(() => { categoriesApi.list().then(setCategories).catch(() => undefined); pagesApi.tags().then(setKnownTags).catch(() => undefined); }, []);
  useEffect(() => {
    const reloadForAccessChange = () => {
      void Promise.all([
        pagesApi.list({
          page: 1,
          perPage: 100,
          status:
            viewMode === 'toc' || filter === 'all' ? undefined : filter,
        }),
        categoriesApi.list(),
        pagesApi.tags(),
      ])
        .then(([pageResult, categoryResult, tagResult]) => {
          setItems(pageResult.data.filter((page) => page.type === 'page'));
          setFolders(pageResult.data.filter((page) => page.type === 'folder'));
          setCategories(categoryResult);
          setKnownTags(tagResult);
        })
        .catch(() => undefined);
    };
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
    return () =>
      window.removeEventListener(
        ACCESS_CONTROL_UPDATED_EVENT,
        reloadForAccessChange,
      );
  }, [filter, viewMode]);

  function selectImportFiles(source: FileList | File[]) {
    const files = Array.from(source).filter((file) => /\.(md|markdown|txt)$/i.test(file.name));
    setSelectedFiles(files);
    setImportTitle(files.length === 1 ? files[0].name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ') : '');
    if (files[0]) void files[0].text().then((content) => setImportPreview(content));
    else setImportPreview('');
  }

  function closeImport() {
    if (importing) return;
    setImportOpen(false);
    setSelectedFiles([]);
    setImportPreview('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function importFiles() {
    if (!selectedFiles.length) return;
    setImporting(true);
    try {
      const tags = importTags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
      for (const file of selectedFiles) {
        const content = await file.text();
        const filenameTitle = file.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
        const title = selectedFiles.length === 1 && importTitle.trim() ? importTitle.trim() : filenameTitle;
        await pagesApi.create({ title: title || t('untitledImport'), type: 'page', content, excerpt: content.slice(0, 500), status: importStatus, isPublic: false, mcpVisible: false, categoryId: importCategoryId || null, parentId: importParentId || null, tags });
      }
      const res = await pagesApi.list({ page: 1, perPage: 100 });
      setItems(res.data.filter((p) => p.type === 'page'));
      setImportOpen(false);
      setSelectedFiles([]);
      setImportPreview('');
      if (fileInput.current) fileInput.current.value = '';
    } finally { setImporting(false); }
  }

  async function moveToTrash(page: Page) {
    if (!window.confirm(t('moveToTrashConfirm'))) return;
    await pagesApi.remove(page.id);
    setItems((current) => current.filter((item) => item.id !== page.id));
    toast.success(t('movedToTrash'), { action: { label: t('undo'), onClick: () => { void pagesApi.restore(page.id).then(() => window.location.reload()); } } });
  }

  const selectedCategory = categorySlug ? categories.find((category) => category.slug === categorySlug) ?? null : null;
  const visibleItems = selectedCategory ? items.filter((page) => page.categoryId === selectedCategory.id) : items;
  const visibleFolders = selectedCategory ? folders.filter((folder) => folder.categoryId === selectedCategory.id) : folders;
  const visibleCategories = selectedCategory ? [selectedCategory] : categories;

  async function exportCategory(format: 'pdf' | 'markdown') {
    if (!selectedCategory) return;
    setExportingCategory(format);
    try {
      saveDownload(await wikiExport.category(selectedCategory.id, format));
    } catch {
      toast.error(t('exportFailed'));
    } finally {
      setExportingCategory(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <KnowledgePageHeader
        icon={BookOpen}
        title={selectedCategory?.name ?? t('title')}
        subtitle={selectedCategory?.description ?? t('subtitle')}
        iconClassName="bg-accent-50 text-accent-700"
        actions={<>
        {selectedCategory && <ExportMenu
          label={t('exportCategory')}
          busy={exportingCategory}
          options={[
            { value: 'pdf', label: t('exportCategoryPdf'), kind: 'pdf' },
            { value: 'markdown', label: t('exportCategoryMarkdown'), kind: 'markdown' },
          ]}
          onSelect={(format) => void exportCategory(format)}
        />}
        <Link href="/wiki/graph" className={knowledgeHeaderSecondaryAction}><Network className="h-4 w-4" />{t('graph')}</Link>
        {canCreatePages && <><input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple className="hidden" onChange={(event) => selectImportFiles(event.target.files ?? [])} />
        <button type="button" disabled={importing} onClick={() => setImportOpen(true)} className={knowledgeHeaderSecondaryAction}><Upload className="h-4 w-4" />{t('import')}</button></>}
        {canCreatePages &&
        <Link
          href="/wiki/new"
          className={knowledgeHeaderPrimaryAction}
        >
          <Plus className="h-4 w-4" />
          {t('newPage')}
        </Link>}
        {canManageTrash && <Link href="/wiki/trash" aria-label={t('trash')} title={t('trash')} className={knowledgeHeaderIconAction}><Trash2 className="h-4 w-4" /></Link>}
        </>}
      />

      {importOpen && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-soft-lg"><h2 className="text-lg font-semibold text-foreground">{t('importTitle')}</h2><p className="mt-1 text-sm text-muted">{selectedFiles.length ? t('importFiles', { count: selectedFiles.length }) : t('importDropHint')}</p><button type="button" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectImportFiles(event.dataTransfer.files); }} onClick={() => fileInput.current?.click()} className="mt-4 flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent-300 bg-accent-50/50 px-4 text-center text-sm text-accent-700 transition-colors hover:border-accent-500 hover:bg-accent-50 cursor-pointer"><FileUp className="h-6 w-6" /><span className="font-medium">{t('importDropzone')}</span><span className="text-xs text-muted">{t('importAccept')}</span></button>{selectedFiles.length > 0 && <><div className="mt-4 rounded-lg border border-border bg-background p-3"><p className="text-xs font-medium text-muted">{t('previewTitle')}</p><p className="mt-1 truncate text-sm font-medium text-foreground">{selectedFiles[0].name}</p><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted">{importPreview.slice(0, 3000)}</pre></div><div className="mt-5 grid gap-3">{selectedFiles.length === 1 && <label className="text-sm font-medium text-foreground">{t('importPageTitle')}<input value={importTitle} onChange={(e) => setImportTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>}<label className="text-sm font-medium text-foreground">{t('importCategory')}<select value={importCategoryId} onChange={(e) => setImportCategoryId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">{t('importNone')}</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label><label className="text-sm font-medium text-foreground">{t('importParent')}<select value={importParentId} onChange={(e) => setImportParentId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="">{t('importNone')}</option>{folders.filter((folder) => !importCategoryId || folder.categoryId === importCategoryId).map((folder) => <option value={folder.id} key={folder.id}>{folder.title}</option>)}</select></label><label className="text-sm font-medium text-foreground">{t('importTags')}<input value={importTags} onChange={(e) => setImportTags(e.target.value)} placeholder={t('importTagsPlaceholder')} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></label>{knownTags.length > 0 && <div><p className="mb-2 text-xs font-medium text-muted">{t('knownTags')}</p><div className="flex flex-wrap gap-2">{knownTags.filter((tag) => !importTags.split(',').map((value) => value.trim().toLowerCase()).includes(tag.toLowerCase())).map((tag) => <button key={tag} type="button" onClick={() => setImportTags((value) => [...value.split(',').map((part) => part.trim()).filter(Boolean), tag].join(', '))} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent-300 hover:bg-accent-50 cursor-pointer">{tag}</button>)}</div></div>}<label className="text-sm font-medium text-foreground">{t('importStatus')}<select value={importStatus} onChange={(e) => setImportStatus(e.target.value as PageStatus)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"><option value="draft">{t('statusDraft')}</option><option value="published">{t('statusPublished')}</option></select></label></div></>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={closeImport} className="min-h-10 rounded-lg border border-border px-4 text-sm font-medium cursor-pointer">{t('importCancel')}</button><button type="button" onClick={() => void importFiles()} disabled={importing || !selectedFiles.length} className="min-h-10 rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer">{importing ? t('importing') : t('import')}</button></div></div></div>}

      <div className="mb-5 mt-6 flex w-fit gap-1 rounded-lg border border-border bg-surface p-1">
        <button type="button" onClick={() => setViewMode('overview')} className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${viewMode === 'overview' ? 'bg-accent-600 text-white' : 'text-muted hover:bg-background hover:text-foreground'}`}><FileText className="h-4 w-4" />{t('overviewView')}</button>
        <button type="button" onClick={() => setViewMode('toc')} className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${viewMode === 'toc' ? 'bg-accent-600 text-white' : 'text-muted hover:bg-background hover:text-foreground'}`}><FolderTree className="h-4 w-4" />{t('tocView')}</button>
      </div>

      {/* Status-Filter */}
      {viewMode === 'overview' && <div className="mb-5 flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
              filter === f.key
                ? 'bg-accent-600 text-white'
                : 'text-muted hover:bg-background hover:text-foreground'
            }`}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>}

      {/* Liste */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : viewMode === 'toc' ? (
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          {visibleCategories.map((category) => {
            const categoryFolders = visibleFolders.filter((folder) => folder.categoryId === category.id);
            const categoryPages = visibleItems.filter((page) => page.categoryId === category.id && !page.parentId);
            return <section key={category.id} className="border-b border-border py-4 first:pt-0 last:border-0 last:pb-0"><h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FolderTree className="h-4 w-4 text-brand-600" />{category.name}</h2><div className="mt-3 space-y-3 pl-2 sm:pl-6">{categoryFolders.map((folder) => <div key={folder.id}><p className="flex items-center gap-2 text-sm font-medium text-foreground"><Folder className="h-4 w-4 text-muted" />{folder.title}</p><div className="mt-1 space-y-1 pl-6">{visibleItems.filter((page) => page.parentId === folder.id).map((page) => <Link key={page.id} href={`/wiki/${page.slug}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-accent-50 hover:text-accent-700"><FileText className="h-3.5 w-3.5" />{page.title}</Link>)}</div></div>)}{categoryPages.map((page) => <Link key={page.id} href={`/wiki/${page.slug}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-accent-50 hover:text-accent-700"><FileText className="h-3.5 w-3.5" />{page.title}</Link>)}</div></section>;
          })}
          {!selectedCategory && (folders.some((folder) => !folder.categoryId) || items.some((page) => !page.categoryId)) && <section className="pt-4"><h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FolderTree className="h-4 w-4 text-brand-600" />{t('uncategorized')}</h2><div className="mt-3 space-y-3 pl-2 sm:pl-6">{folders.filter((folder) => !folder.categoryId).map((folder) => <div key={folder.id}><p className="flex items-center gap-2 text-sm font-medium text-foreground"><Folder className="h-4 w-4 text-muted" />{folder.title}</p><div className="mt-1 space-y-1 pl-6">{items.filter((page) => page.parentId === folder.id).map((page) => <Link key={page.id} href={`/wiki/${page.slug}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-accent-50 hover:text-accent-700"><FileText className="h-3.5 w-3.5" />{page.title}</Link>)}</div></div>)}{items.filter((page) => !page.categoryId && !page.parentId).map((page) => <Link key={page.id} href={`/wiki/${page.slug}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-accent-50 hover:text-accent-700"><FileText className="h-3.5 w-3.5" />{page.title}</Link>)}</div></section>}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FileText className="h-8 w-8 text-muted" />
          <p className="text-sm font-medium text-foreground">{t('noPages')}</p>
          <p className="text-sm text-muted">
            {filter === 'all' ? t('createFirst') : t('noPagesForFilter')}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((page) => {
            const badge = STATUS_BADGE[page.status];
            return (
              <li key={page.id}>
                <div className="relative flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent-300 hover:bg-background">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-600">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="flex items-center gap-1"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.tone}`}>{t(badge.labelKey)}</span>{canDeletePages && <button type="button" onClick={() => void moveToTrash(page)} aria-label={t('moveToTrash')} title={t('moveToTrash')} className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-50 hover:text-danger-600 cursor-pointer"><Trash2 className="h-4 w-4" /></button>}</div>
                  </div>
                  <Link href={`/wiki/${page.slug}`} className="text-sm font-semibold text-foreground hover:text-accent-700 cursor-pointer">{page.title}</Link>
                  {page.excerpt && (
                    <p className="line-clamp-2 text-xs text-muted">{page.excerpt}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
