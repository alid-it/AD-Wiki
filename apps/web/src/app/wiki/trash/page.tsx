'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { pages } from '@ad-wiki/api-client';
import type { TrashPage } from '@ad-wiki/shared-types';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { SOCKET_EVENTS, type WikiNotification } from '@ad-wiki/shared-types';
import { useSocketEvent } from '@/lib/socket-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

export default function TrashPageView() {
  const t = useTranslations('trash');
  const { hasPermission } = useAuth();
  const canRestore = hasPermission('pages', 'update');
  const canPermanentlyDelete = hasPermission('pages', 'purge');
  const [items, setItems] = useState<TrashPage[]>([]); const [loading, setLoading] = useState(true);
  const load = () => pages.trash().then(setItems).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const reloadForAccessChange = () => void load();
    window.addEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
    return () => window.removeEventListener(ACCESS_CONTROL_UPDATED_EVENT, reloadForAccessChange);
  }, []);
  useSocketEvent<WikiNotification>(SOCKET_EVENTS.notification, (notification) => {
    if (notification.resource === 'page') void load();
  });
  async function restore(id: string) { if (canRestore) { await pages.restore(id); await load(); } }
  async function remove(id: string) { if (canPermanentlyDelete && window.confirm(t('permanentConfirm'))) { await pages.permanentRemove(id); await load(); } }
  async function emptyTrash() { if (canPermanentlyDelete && window.confirm(t('emptyConfirm'))) { await pages.emptyTrash(); await load(); } }
  return <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8"><div className="mb-6 flex items-center justify-between"><div><h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div><div className="flex items-center gap-2">{canPermanentlyDelete && items.length > 0 && <button type="button" onClick={() => void emptyTrash()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-danger-500/40 px-3 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 cursor-pointer"><Trash2 className="h-4 w-4" />{t('emptyAction')}</button>}<Link href="/wiki" className="text-sm font-medium text-accent-700 hover:text-accent-800 cursor-pointer">{t('back')}</Link></div></div>{loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div> : items.length === 0 ? <p className="py-12 text-center text-sm text-muted">{t('empty')}</p> : <ul className="space-y-2">{items.map((page) => <li key={page.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4"><div><p className="font-medium text-foreground">{page.title}</p><p className="text-xs text-muted">{t('deletedAt', { date: new Date(page.deletedAt).toLocaleString(), user: page.deletedBy?.displayName ?? t('unknown') })}</p></div><div className="flex gap-2">{canRestore && <button type="button" onClick={() => void restore(page.id)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-background cursor-pointer"><RotateCcw className="h-4 w-4" />{t('restore')}</button>}{canPermanentlyDelete && <button type="button" onClick={() => void remove(page.id)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-danger-500/40 px-3 text-sm font-medium text-danger-600 transition-colors hover:bg-danger-50 cursor-pointer"><Trash2 className="h-4 w-4" />{t('permanent')}</button>}</div></li>)}</ul>}</div>;
}
