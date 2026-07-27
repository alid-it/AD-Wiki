'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { SOCKET_EVENTS, type WikiNotification } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useSocketEvent } from '@/lib/socket-context';
import { useToast } from '@/components/ui/toast';

/** Eine gespeicherte Notification mit Gelesen-Status (für die Glocke). */
export interface StoredNotification extends WikiNotification {
  read: boolean;
}

interface NotificationsApi {
  notifications: StoredNotification[];
  unreadCount: number;
  markAllRead: () => void;
  clear: () => void;
  /** Ziel-Route einer Notification (oder null, wenn nicht navigierbar). */
  hrefFor: (n: WikiNotification) => string | null;
}

/** Maximale Anzahl gespeicherter Notifications (Glocken-Historie). */
const MAX_HISTORY = 50;

const NotificationsContext = createContext<NotificationsApi | null>(null);

/** Ermittelt die Ziel-Route einer Notification für die Navigation. */
function hrefFor(n: WikiNotification): string | null {
  switch (n.resource) {
    case 'page':
      return n.slug ? `/wiki/${n.slug}` : null;
    case 'media':
      return '/media';
    case 'user':
      return '/settings/users';
    case 'note':
      return n.resourceId ? `/notes?note=${n.resourceId}` : '/notes';
    case 'backups':
      return '/settings/backups';
    default:
      return null;
  }
}

/**
 * Hört auf eingehende `notification`-Events, zeigt sie als Toast an und hält eine
 * Historie für die Navbar-Glocke vor. Eigene Aktionen werden übersprungen –
 * niemand muss über sein eigenes Tun benachrichtigt werden.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [notifications, setNotifications] = useState<StoredNotification[]>([]);

  useSocketEvent<WikiNotification>(SOCKET_EVENTS.notification, (n) => {
    // Eigene Aktionen ignorieren.
    if (n.actor && user && n.actor.id === user.id) return;

    setNotifications((prev) => [{ ...n, read: false }, ...prev].slice(0, MAX_HISTORY));

    const target = hrefFor(n);
    toast[n.type](n.message, target ? { onClick: () => router.push(target) } : undefined);
  });

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
  }, []);

  const clear = useCallback(() => setNotifications([]), []);

  const unreadCount = useMemo(
    () => notifications.reduce((sum, n) => sum + (n.read ? 0 : 1), 0),
    [notifications],
  );

  const value = useMemo<NotificationsApi>(
    () => ({ notifications, unreadCount, markAllRead, clear, hrefFor }),
    [notifications, unreadCount, markAllRead, clear],
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

/** Zugriff auf Notification-Historie und Zähler (für die Navbar-Glocke). */
export function useNotifications(): NotificationsApi {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications muss innerhalb von <NotificationsProvider> verwendet werden.');
  }
  return ctx;
}
