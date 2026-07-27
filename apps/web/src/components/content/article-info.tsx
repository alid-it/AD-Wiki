'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Pencil,
  Tag,
  History,
  Upload,
  Loader2,
  Clock,
  CalendarPlus,
  GitCommitVertical,
  GitCompare,
  FolderIcon,
  Check,
  ArrowRight,
  Eye,
  Unlink,
  Trash2,
  Paperclip,
  FileText,
  ShieldCheck,
  BookOpen,
  Image as ImageIcon,
} from 'lucide-react';
import { pages as pagesApi, media as mediaApi, wikiExport } from '@ad-wiki/api-client';
import type { Media, PageDetail, PageVersion, RelatedPage } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useLocaleSwitcher } from '@/lib/i18n-context';
import { isImageMime, isPdfMime, isMarkdownFile } from '@/lib/content';
import { MediaPreviewModal } from '@/components/content/media-preview-modal';
import { useToast } from '@/components/ui/toast';
import { ExportMenu } from '@/components/content/export-menu';
import { saveDownload } from '@/lib/download';
import { MediaPickerModal } from '@/components/editor/media-picker-modal';
import { ResourceAclButton } from '@/components/access/resource-acl-dialog';

/** Bis zu zwei Initialen aus einem Namen. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

const VISIBLE_VERSIONS = 5;

/**
 * Info-Spalte rechts neben dem Artikel: Metadaten, Kategorie, Tags, Aktionen
 * (Bearbeiten, Upload) und der Versionsverlauf. Sticky auf Desktop, auf Mobile
 * unterhalb des Inhalts.
 */
export function ArticleInfo({ page }: { page: PageDetail }) {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const canUpdatePage = hasPermission('pages', 'update');
  const canDeletePage = hasPermission('pages', 'delete');
  const canUploadMedia = hasPermission('media', 'create') && hasPermission('media', 'update');
  const canManageMedia = hasPermission('media', 'update');
  const canDeleteMedia = hasPermission('media', 'delete');
  const t = useTranslations('wiki');
  const tc = useTranslations('common');
  const { locale } = useLocaleSwitcher();
  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [backlinks, setBacklinks] = useState<Array<{ id: string; title: string; slug: string }>>([]);
  const [standardBacklinks, setStandardBacklinks] = useState<Array<{ id: string; title: string; slug: string; status: string }>>([]);
  const [relatedPages, setRelatedPages] = useState<RelatedPage[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<Media[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(true);
  const [preview, setPreview] = useState<Media | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Media | null>(null);
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'markdown' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    pagesApi
      .versions(page.id, controller.signal)
      .then(setVersions)
      .catch(() => {
        /* Versionsliste ist optional. */
      })
      .finally(() => setLoadingVersions(false));
    return () => controller.abort();
  }, [page.id]);

  useEffect(() => { const controller = new AbortController(); pagesApi.backlinks(page.slug, controller.signal).then(setBacklinks).catch(() => undefined); return () => controller.abort(); }, [page.slug]);
  useEffect(() => { const controller = new AbortController(); pagesApi.standardBacklinks(page.slug, controller.signal).then(setStandardBacklinks).catch(() => undefined); return () => controller.abort(); }, [page.slug]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingRelated(true);
    pagesApi.related(page.id, 5, controller.signal)
      .then(setRelatedPages)
      .catch(() => setRelatedPages([]))
      .finally(() => { if (!controller.signal.aborted) setLoadingRelated(false); });
    return () => controller.abort();
  }, [page.id]);

  useEffect(() => {
    const controller = new AbortController();
    mediaApi
      .list({ page: 1, limit: 100, pageId: page.id }, controller.signal)
      .then((result) => setAttachments(result.data))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setMediaError(t('filesLoadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAttachments(false);
      });
    return () => controller.abort();
  }, [page.id]);

  async function handleUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setUploaded(null);
    setMediaError(null);
    try {
      const result = await mediaApi.upload(file);
      const linked = await mediaApi.setPages(result.id, { pageIds: [page.id] });
      setAttachments((current) => [linked, ...current]);
      setUploaded(result.filename);
    } catch {
      setMediaError(t('uploadFileFailed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function unlinkMedia(item: Media) {
    setBusyMediaId(item.id);
    setMediaError(null);
    try {
      await mediaApi.setPages(item.id, {
        pageIds: item.pageIds.filter((pageId) => pageId !== page.id),
      });
      setAttachments((current) => current.filter((media) => media.id !== item.id));
    } catch {
      setMediaError(t('unlinkFailed'));
    } finally {
      setBusyMediaId(null);
    }
  }

  async function deleteMedia() {
    if (!pendingDelete) return;
    setBusyMediaId(pendingDelete.id);
    setMediaError(null);
    try {
      await mediaApi.remove(pendingDelete.id);
      setAttachments((current) => current.filter((media) => media.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch {
      setMediaError(t('deleteFileFailed'));
    } finally {
      setBusyMediaId(null);
    }
  }

  async function movePageToTrash() {
    if (!window.confirm(t('moveToTrashConfirm'))) return;
    await pagesApi.remove(page.id);
    toast.success(t('movedToTrash'), {
      action: { label: t('undo'), onClick: () => { void pagesApi.restore(page.id).then(() => router.replace(`/wiki/${page.slug}`)); } },
    });
    router.replace('/wiki');
  }

  async function exportPage(format: 'pdf' | 'markdown') {
    setExporting(format);
    try {
      saveDownload(await wikiExport.page(page.id, format));
    } catch {
      toast.error(t('exportFailed'));
    } finally {
      setExporting(null);
    }
  }

  const shownVersions = versions.slice(0, VISIBLE_VERSIONS);

  return (
    <div className="flex flex-col gap-4 lg:sticky lg:top-20">
      {/* Aktionen */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <ResourceAclButton
            target={{
              type: 'page',
              id: page.id,
              label: page.title,
              resources: ['pages'],
            }}
          />
          <ExportMenu
            label={t('export')}
            busy={exporting}
            options={[
              { value: 'pdf', label: t('exportPdf'), kind: 'pdf' },
              { value: 'markdown', label: t('exportMarkdown'), kind: 'markdown' },
            ]}
            onSelect={(format) => void exportPage(format)}
          />
          {page.isPublic && page.status === 'published' && <Link
            href={`/public/wiki/${page.slug}`}
            target="_blank"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-success-500/40 px-4 py-2 text-sm font-semibold text-success-600 transition-colors hover:bg-success-50 cursor-pointer"
          >
            <Eye className="h-4 w-4" />
            {t('viewPublic')}
          </Link>}
          {canUpdatePage && <Link
            href={`/wiki/${page.slug}/edit`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft-sm transition-colors hover:bg-brand-700 cursor-pointer"
          >
            <Pencil className="h-4 w-4" />
            {t('edit')}
          </Link>}
          {canDeletePage && <button
            type="button"
            onClick={() => void movePageToTrash()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-danger-500/40 px-4 py-2 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
            {t('moveToTrash')}
          </button>}
          {canUploadMedia && <button
            type="button"
            onClick={() => setMediaPickerOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background cursor-pointer"
          >
            <ImageIcon className="h-4 w-4" />
            {t('addImage')}
          </button>}
          {canUploadMedia && <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t('uploadFile')}
          </button>}
          {canUploadMedia && <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,.md,.markdown"
            onChange={(event) => void handleUpload(event.target.files)}
          />}
          {uploaded && <p className="flex items-center gap-1 text-xs text-success-600"><Check className="h-3.5 w-3.5" />{t('uploaded', { name: uploaded })}</p>}
      </div>

      {/* Mit dieser Seite verknüpfte Dateien */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <Paperclip className="h-3.5 w-3.5" />
          {t('files')}
        </h2>

        {mediaError && <p className="mb-3 text-xs text-danger-600">{mediaError}</p>}

        {loadingAttachments ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          </div>
        ) : attachments.length === 0 ? (
          <p className="text-xs text-muted">{t('noFiles')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attachments.map((item) => {
              const busy = busyMediaId === item.id;
              const previewable =
                isImageMime(item.mimetype) ||
                isPdfMime(item.mimetype) ||
                isMarkdownFile(item.mimetype, item.filename);
              return (
                <li
                  key={item.id}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={item.filename}>
                    {item.filename}
                  </span>
                  {previewable && (
                    <button
                      type="button"
                      onClick={() => setPreview(item)}
                      aria-label={t('previewOf', { name: item.filename })}
                      title={t('previewTitle')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground cursor-pointer"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}
                   {(canManageMedia || canDeleteMedia) && (
                     <>
                       {canManageMedia &&
                       <button
                        type="button"
                        onClick={() => void unlinkMedia(item)}
                        disabled={busy}
                        aria-label={t('unlinkOf', { name: item.filename })}
                        title={t('unlink')}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-accent-700 disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                       </button>
                       }
                       {canDeleteMedia &&
                       <button
                        type="button"
                        onClick={() => setPendingDelete(item)}
                        disabled={busy}
                        aria-label={t('deleteOf', { name: item.filename })}
                        title={t('deleteFilePermanently')}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                       </button>
                       }
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {preview && <MediaPreviewModal media={preview} onClose={() => setPreview(null)} />}
      {mediaPickerOpen && <MediaPickerModal
        pageId={page.id}
        onClose={() => setMediaPickerOpen(false)}
        onSelect={(item) => {
          setAttachments((current) => current.some((entry) => entry.id === item.id)
            ? current.map((entry) => entry.id === item.id ? item : entry)
            : [item, ...current]);
          setUploaded(item.filename);
        }}
      />}

       {pendingDelete && canDeleteMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            onClick={() => busyMediaId === null && setPendingDelete(null)}
            aria-label={t('deleteFileTitle')}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-pointer"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-media-title"
            className="relative w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-soft-lg"
          >
            <h2 id="delete-media-title" className="text-base font-semibold text-foreground">
              {t('deleteFileTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {t('deleteFileText', { name: pendingDelete.filename })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={busyMediaId !== null}
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-background disabled:opacity-50 cursor-pointer"
              >
                {tc('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void deleteMedia()}
                disabled={busyMediaId !== null}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-danger-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-danger-500 disabled:opacity-50 cursor-pointer"
              >
                {busyMediaId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {tc('delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metadaten */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('information')}
        </h2>

        {/* Autor */}
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials(page.author.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {page.author.displayName}
            </p>
            <p className="text-xs text-muted">{t('author')}</p>
          </div>
        </div>

        <dl className="flex flex-col gap-2.5 text-sm">
          <InfoRow icon={CalendarPlus} label={t('created')} value={formatDate(page.createdAt)} />
          <InfoRow icon={Clock} label={t('edited')} value={formatDate(page.updatedAt)} />
          <InfoRow icon={GitCommitVertical} label={t('version')} value={String(page.version)} />
        </dl>

        {/* Kategorie */}
        {page.category && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-muted">{t('category')}</p>
            <Link
              href={`/wiki?category=${page.category.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100 cursor-pointer"
            >
              <FolderIcon className="h-3 w-3" />
              {page.category.name}
            </Link>
          </div>
        )}

        {/* Tags */}
        {page.tags.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium text-muted">{t('tags')}</p>
            <div className="flex flex-wrap gap-1.5">
              {page.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-background px-2.5 py-1 text-xs text-muted"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Nach gemeinsamen Tags und Kategorie ermittelte Artikel. */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <BookOpen className="h-3.5 w-3.5" />
          {t('relatedArticles')}
        </h2>
        {loadingRelated ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted" /></div>
        ) : relatedPages.length === 0 ? (
          <p className="text-xs text-muted">{t('noRelatedArticles')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {relatedPages.map((related) => (
              <li key={related.id}>
                <Link href={`/wiki/${related.slug}`} className="group block rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-accent-300 hover:bg-accent-50/50">
                  <span className="block text-sm font-medium text-foreground transition-colors group-hover:text-accent-700">{related.title}</span>
                  {related.sharedTags.length > 0 && (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {related.sharedTags.map((tag) => <span key={tag} className="rounded-full bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium text-accent-700">#{tag}</span>)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Versionsverlauf */}
      {backlinks.length > 0 && <div className="rounded-xl border border-border bg-surface p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{t('backlinks')}</h2><ul className="flex flex-col gap-1">{backlinks.map((link) => <li key={link.id}><Link href={`/wiki/${link.slug}`} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-accent-700 transition-colors hover:bg-accent-50 cursor-pointer"><FileText className="h-3.5 w-3.5" />{link.title}</Link></li>)}</ul></div>}
      {standardBacklinks.length > 0 && <div className="rounded-xl border border-border bg-surface p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{t('standardBacklinks')}</h2><ul className="flex flex-col gap-1">{standardBacklinks.map((link) => <li key={link.id}><Link href={`/standards?standard=${link.id}`} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-danger-600 transition-colors hover:bg-danger-50 cursor-pointer"><ShieldCheck className="h-3.5 w-3.5" />{link.title}</Link></li>)}</ul></div>}

      {/* Versionsverlauf */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <History className="h-3.5 w-3.5" />
          {t('versionHistory')}
        </h2>

        {loadingVersions ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          </div>
        ) : versions.length === 0 ? (
          <p className="text-xs text-muted">{t('noOlderVersions')}</p>
        ) : (
          <>
            <ol className="flex flex-col gap-3">
              {shownVersions.map((v) => (
                <li key={v.id} className="group/ver flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex h-6 w-9 shrink-0 items-center justify-center rounded bg-background text-[11px] font-medium text-muted">
                    v{v.version}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {v.changeMessage || t('withoutChangeMessage')}
                    </p>
                    <p className="text-[11px] text-muted">
                      {v.author.displayName} · {formatDate(v.createdAt)}
                    </p>
                  </div>
                  {/* Direkt-Diff mit der Vorgängerversion */}
                  {v.version > 1 && (
                    <Link
                      href={`/wiki/${page.slug}/versions/diff?from=${v.version - 1}&to=${v.version}`}
                      aria-label={t('compareVersionAria', { to: v.version, from: v.version - 1 })}
                      title={t('compareWithPrevious')}
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/ver:opacity-100 cursor-pointer"
                    >
                      <GitCompare className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </li>
              ))}
            </ol>

            <Link
              href={`/wiki/${page.slug}/versions`}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent-600 transition-colors hover:text-accent-700 cursor-pointer"
            >
              {t('allVersions')}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-1.5 text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
