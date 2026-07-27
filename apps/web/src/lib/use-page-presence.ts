'use client';

import { useEffect, useState } from 'react';
import {
  SOCKET_EVENTS,
  type PagePresenceEvent,
  type PageEditingEvent,
  type PresenceUser,
} from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useSocket, useSocketEvent } from '@/lib/socket-context';

/** Ergebnis von {@link usePagePresence}. */
interface PagePresenceState {
  /** Andere Benutzer, die die Seite gerade ansehen (ohne einen selbst). */
  others: PresenceUser[];
  /** Andere Benutzer, die die Seite gerade bearbeiten (ohne einen selbst). */
  editingOthers: PresenceUser[];
}

/**
 * Verwaltet die Live-Presence einer Wiki-Seite: tritt beim Mount dem Seiten-Raum
 * bei, verlässt ihn beim Unmount und hält die Liste der anwesenden bzw. gerade
 * bearbeitenden Benutzer aktuell.
 *
 * @param pageId          ID der betrachteten Seite.
 * @param announceEditing Wenn true, meldet diese Verbindung „bearbeitet gerade"
 *                        (für die Editor-Ansicht). Neu hinzukommenden Betrachtern
 *                        wird der Editier-Status erneut angekündigt.
 */
export function usePagePresence(
  pageId: string | null,
  announceEditing = false,
): PagePresenceState {
  const socket = useSocket();
  const { user } = useAuth();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [editing, setEditing] = useState<PresenceUser[]>([]);

  // Raum betreten/verlassen; bei announceEditing zusätzlich Editier-Status senden.
  useEffect(() => {
    if (!socket || !pageId) return;

    const onConnect = () => {
      socket.emit(SOCKET_EVENTS.joinPage, pageId);
      if (announceEditing) {
        socket.emit(SOCKET_EVENTS.setEditing, { pageId, editing: true });
      }
    };

    if (socket.connected) onConnect();
    socket.on('connect', onConnect); // nach Reconnect erneut beitreten

    return () => {
      if (announceEditing) {
        socket.emit(SOCKET_EVENTS.setEditing, { pageId, editing: false });
      }
      socket.emit(SOCKET_EVENTS.leavePage, pageId);
      socket.off('connect', onConnect);
      setUsers([]);
      setEditing([]);
    };
  }, [socket, pageId, announceEditing]);

  useSocketEvent<PagePresenceEvent>(SOCKET_EVENTS.userJoined, (e) => {
    if (e.pageId !== pageId) return;
    setUsers(e.users);
    // Kommt ein anderer Betrachter dazu, den eigenen Editier-Status neu ankündigen,
    // damit auch spät hinzugekommene Nutzer den „bearbeitet gerade"-Hinweis sehen.
    if (announceEditing && socket && e.user.id !== user?.id) {
      socket.emit(SOCKET_EVENTS.setEditing, { pageId, editing: true });
    }
  });

  useSocketEvent<PagePresenceEvent>(SOCKET_EVENTS.userLeft, (e) => {
    if (e.pageId !== pageId) return;
    setUsers(e.users);
    setEditing((prev) => prev.filter((u) => u.id !== e.user.id));
  });

  useSocketEvent<PageEditingEvent>(SOCKET_EVENTS.pageEditing, (e) => {
    if (e.pageId !== pageId) return;
    setEditing((prev) => {
      const without = prev.filter((u) => u.id !== e.user.id);
      return e.editing ? [...without, e.user] : without;
    });
  });

  const others = users.filter((u) => u.id !== user?.id);
  const editingOthers = editing.filter((u) => u.id !== user?.id);
  return { others, editingOthers };
}
