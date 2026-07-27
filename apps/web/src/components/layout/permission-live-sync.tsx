'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  SOCKET_EVENTS,
  type AccessControlChangedEvent,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useSocketEvent } from '@/lib/socket-context';
import { dispatchAccessControlUpdated } from '@/lib/access-control-events';

/** Keeps permission-driven navigation and controls in sync after ACL changes. */
export function PermissionLiveSync() {
  const { refreshPermissions } = useAuth();
  const router = useRouter();
  const pendingEvent = useRef<AccessControlChangedEvent | null>(null);
  const refreshTimer = useRef<number | null>(null);
  useSocketEvent<AccessControlChangedEvent>(
    SOCKET_EVENTS.permissionsUpdated,
    (event) => {
      pendingEvent.current = event;
      if (refreshTimer.current !== null) return;
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        const latestEvent = pendingEvent.current;
        pendingEvent.current = null;
        void refreshPermissions();
        router.refresh();
        if (latestEvent) dispatchAccessControlUpdated(latestEvent);
      }, 75);
    },
  );
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) {
        window.clearTimeout(refreshTimer.current);
      }
    },
    [],
  );
  return null;
}
