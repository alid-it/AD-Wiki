'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, AlertTriangle, Folder, Loader2, Trash2, X } from 'lucide-react';
import { ApiClientError, pages as pagesApi } from '@ad-wiki/api-client';
import type { Page } from '@ad-wiki/shared-types';
import { ResourceAclButton } from '@/components/access/resource-acl-dialog';
import { useAuth } from '@/lib/auth-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

interface FolderWithCount extends Page { childCount: number; }

export default function FoldersSettingsPage() {
  const t = useTranslations('settings.folders');
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('pages', 'delete');
  const [items, setItems] = useState<FolderWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FolderWithCount | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function reload() {
    try {
      const result = await pagesApi.list({ page: 1, perPage: 100 });
      const all = result.data;
      setItems(all.filter((page) => page.type === 'folder').map((folder) => ({ ...folder, childCount: all.filter((page) => page.parentId === folder.id).length })));
    } catch { setError(t('loadFailed')); }
    finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    const reloadForAccessChange = () => void reload();
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
    return () => window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
  }, []);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true); setError(null);
    try { await pagesApi.remove(deleteTarget.id); setDeleteTarget(null); await reload(); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : t('deleteFailed')); }
    finally { setDeleting(false); }
  }

  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold text-foreground">{t('heading')}</h2><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-500/30 bg-danger-50 px-3 py-2.5 text-sm text-danger-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
    {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : <ul className="flex flex-col gap-2">
      {items.map((folder) => <li key={folder.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Folder className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{folder.title}</p><p className="text-xs text-muted">{t('pageCount', { count: folder.childCount })}</p></div><ResourceAclButton compact target={{ type: 'page', id: folder.id, label: folder.title, resources: ['pages'] }} />{canDelete && <button type="button" onClick={() => setDeleteTarget(folder)} aria-label={t('delete')} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-danger-50 hover:text-danger-600 cursor-pointer"><Trash2 className="h-4 w-4" /></button>}</li>)}
      {items.length === 0 && <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{t('empty')}</li>}
    </ul>}
    {deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div role="button" tabIndex={0} aria-label={t('cancel')} onClick={() => !deleting && setDeleteTarget(null)} onKeyDown={(event) => event.key === 'Escape' && setDeleteTarget(null)} className="absolute inset-0 bg-black/50 backdrop-blur-sm" /><div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-soft-lg"><div className="mb-2 flex items-center justify-between"><h3 className="text-base font-semibold text-foreground">{t('deleteTitle')}</h3><button type="button" onClick={() => setDeleteTarget(null)} aria-label={t('close')} className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-background cursor-pointer"><X className="h-4 w-4" /></button></div>{deleteTarget.childCount > 0 && <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning-500/30 bg-warning-50 px-3 py-2.5 text-sm text-warning-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t('deleteWarning', { count: deleteTarget.childCount })}</span></div>}<p className="mb-5 text-sm text-muted">{t('deleteText', { name: deleteTarget.title })}</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background disabled:opacity-60 cursor-pointer">{t('cancel')}</button><button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-danger-600 px-4 py-2 text-sm font-semibold text-white hover:bg-danger-500 disabled:opacity-70 cursor-pointer">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{t('delete')}</button></div></div></div>}
  </div>;
}
