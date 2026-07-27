'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SOCKET_EVENTS, type PageCreatedEvent, type WikiNotification } from '@ad-wiki/shared-types';
import { useSocketEvent } from '@/lib/socket-context';
import { ACCESS_CONTROL_UPDATED_EVENT } from '@/lib/access-control-events';

/**
 * Hält die serverseitig geladene Sidebar-Baumstruktur aktuell: löst einen weichen
 * Refresh (`router.refresh`) aus, wenn an anderer Stelle Seiten oder Kategorien
 * erstellt, geändert oder gelöscht werden. Eigene Aktionen werden ignoriert, um
 * unnötige Refreshes zu vermeiden.
 */
export function SidebarLiveSync() {
  const router = useRouter();
  useSocketEvent<PageCreatedEvent>(SOCKET_EVENTS.pageCreated, () => {
    router.refresh();
  });
  useSocketEvent<WikiNotification>(SOCKET_EVENTS.notification, (notification) => {
    if (notification.resource === 'category') {
      router.refresh();
    }
  });
  useEffect(() => {
    const refreshForAccessChange = () => router.refresh();
    window.addEventListener(
      ACCESS_CONTROL_UPDATED_EVENT,
      refreshForAccessChange,
    );
    return () =>
      window.removeEventListener(
        ACCESS_CONTROL_UPDATED_EVENT,
        refreshForAccessChange,
      );
  }, [router]);

  return null;
}
