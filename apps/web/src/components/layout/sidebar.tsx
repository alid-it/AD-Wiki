'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { X, Inbox, WifiOff, Trash2 } from 'lucide-react';
import { loadSidebarCategories, type SidebarCategory } from '@/lib/wiki-data';
import { useSidebar } from '@/lib/sidebar-context';
import { useAuth } from '@/lib/auth-context';
import { SidebarTree } from '@/components/layout/sidebar-tree';
import { SidebarLiveSync } from '@/components/layout/sidebar-live-sync';
import { pages } from '@ad-wiki/api-client';
import { SOCKET_EVENTS, type WikiNotification } from '@ad-wiki/shared-types';
import { useSocketEvent } from '@/lib/socket-context';

interface WikiSidebarProps {
  categories: SidebarCategory[];
  /** True, wenn die Kategorien nicht geladen werden konnten. */
  failed?: boolean;
  children: React.ReactNode;
}

/**
 * Shell des Wiki-Bereichs. Rendert eine EINZIGE, responsive `<aside>`:
 * - ≥ lg: statisch im Fluss, einklappbar (Breite animiert)
 * - < lg: fixiertes Overlay (Drawer) mit Backdrop
 *
 * Der Baum wird bewusst nur einmal gerendert, damit die Drag-and-Drop-Instanz
 * eindeutig bleibt. Sichtbarkeit/Overlay kommen aus {@link useSidebar}.
 */
export function WikiSidebar({ categories, failed = false, children }: WikiSidebarProps) {
  const { desktopVisible, mobileOpen, closeMobile } = useSidebar();
  const { isAuthenticated, hasPermission } = useAuth();
  const t = useTranslations('sidebar');
  const [trashCount, setTrashCount] = useState(0);
  const [liveCategories, setLiveCategories] = useState<SidebarCategory[]>(categories);
  const [liveFailed, setLiveFailed] = useState(failed);
  const canManageTrash = hasPermission('pages', 'update');
  const canReadPages = hasPermission('pages', 'read');

  const reloadSidebar = useCallback(() => {
    if (!canReadPages) return;
    loadSidebarCategories().then(({ categories: next, failed: nextFailed }) => {
      setLiveCategories(next);
      setLiveFailed(nextFailed);
    });
  }, [canReadPages]);

  useEffect(() => {
    if (!canManageTrash) { setTrashCount(0); return; }
    pages.trash().then((items) => setTrashCount(items.length)).catch(() => setTrashCount(0));
  }, [canManageTrash]);
  useEffect(() => {
    reloadSidebar();
  }, [reloadSidebar]);
  useSocketEvent<WikiNotification>(SOCKET_EVENTS.notification, (notification) => {
    if (notification.resource === 'page' || notification.resource === 'category') reloadSidebar();
    if (canManageTrash && notification.resource === 'page') {
      pages.trash().then((items) => setTrashCount(items.length)).catch(() => undefined);
    }
  });

  const content = liveFailed ? (
    <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
      <WifiOff className="h-6 w-6 text-muted" />
      <p className="text-sm font-medium text-foreground">{t('notReachable')}</p>
      <p className="text-xs text-muted">{t('categoriesLoadFailed')}</p>
    </div>
  ) : liveCategories.length === 0 ? (
    <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
      <Inbox className="h-6 w-6 text-muted" />
      <p className="text-sm font-medium text-foreground">{t('noPages')}</p>
      <p className="text-xs text-muted">{t('createCategoryOrPage')}</p>
    </div>
  ) : (
    <SidebarTree categories={liveCategories} canEdit={hasPermission('pages', 'update')} onNavigate={closeMobile} />
  );

  return (
    <div className="wiki-shell lg:flex lg:h-[calc(100vh-3.5rem)]">
      {/* Aktualisiert den Baum live bei Seiten-/Kategorie-Änderungen anderer Nutzer. */}
      <SidebarLiveSync />

      {/* Backdrop (nur < lg, wenn Overlay offen) */}
      {mobileOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label={t('close')}
          onClick={closeMobile}
          onKeyDown={(e) => e.key === 'Escape' && closeMobile()}
          className="fixed inset-0 top-14 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Eine Aside für alle Breakpoints */}
      <aside
        className={`wiki-sidebar fixed bottom-0 left-0 top-14 z-40 w-full overflow-hidden border-r border-border bg-surface shadow-soft-lg transition-transform duration-200 ease-out sm:w-80 lg:static lg:top-0 lg:z-auto lg:shadow-none lg:transition-[width] ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 ${desktopVisible ? 'lg:w-64' : 'lg:w-0 lg:border-0'}`}
      >
        <div className="flex h-full w-full flex-col sm:w-80 lg:w-64">
          {/* Kopf nur im Overlay (mobil/tablet) */}
          <div className="flex items-center justify-between px-3 pt-3 lg:hidden">
            <span className="px-2 text-sm font-semibold text-foreground">{t('navigation')}</span>
            <button
              type="button"
              onClick={closeMobile}
              aria-label={t('closeMenu')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent-50 hover:text-foreground cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{content}</div>
          {isAuthenticated && canManageTrash && <div className="border-t border-border p-2"><Link href="/wiki/trash" onClick={closeMobile} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-accent-50 hover:text-foreground cursor-pointer"><Trash2 className="h-4 w-4" />{t('trash')}{trashCount > 0 && <span className="ml-auto rounded-full bg-accent-100 px-2 py-0.5 text-xs font-semibold text-accent-700">{trashCount}</span>}</Link></div>}
        </div>
      </aside>

      {/* Inhaltsbereich */}
      <div className="wiki-content-scroll h-[calc(100vh-3.5rem)] flex-1 overflow-y-auto bg-background lg:h-full">
        {children}
      </div>
    </div>
  );
}
