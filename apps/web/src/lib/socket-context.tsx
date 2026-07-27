'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { getTokenStore } from '@ad-wiki/api-client';
import { useAuth } from '@/lib/auth-context';

/**
 * Ermittelt die WebSocket-Basis-URL aus der REST-Basis-URL (ohne /api/v1-Pfad).
 * socket.io lauscht auf demselben Host/Port wie die API.
 */
function resolveSocketUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  try {
    const browserOrigin =
      typeof window !== 'undefined' ? window.location.origin : undefined;
    return new URL(apiUrl, browserOrigin).origin;
  } catch {
    return 'http://localhost:4000';
  }
}

const SocketContext = createContext<Socket | null>(null);

/**
 * Stellt eine WebSocket-Verbindung bereit, sobald ein Benutzer eingeloggt ist.
 *
 * - Lazy connect: Die Verbindung wird erst nach erfolgreichem Login aufgebaut und
 *   blockiert den UI-Start nicht.
 * - Der Token wird bei jedem (Re-)Connect frisch aus dem Token-Store gelesen,
 *   damit auch nach einem Token-Refresh authentifiziert wird.
 * - Reconnect ist aktiv; bei Logout wird die Verbindung getrennt.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      // Abgemeldet: bestehende Verbindung trennen.
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      return;
    }

    // Bereits verbunden – nichts tun.
    if (socketRef.current) return;

    const instance = io(resolveSocketUrl(), {
      transports: ['websocket'],
      // Token bei jedem (Re-)Connect frisch lesen (überlebt Token-Refresh).
      auth: (cb) => cb({ token: getTokenStore().getAccessToken() ?? '' }),
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = instance;
    setSocket(instance);

    return () => {
      instance.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [isAuthenticated]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

/** Zugriff auf die aktuelle Socket-Verbindung (oder `null`, wenn nicht verbunden). */
export function useSocket(): Socket | null {
  return useContext(SocketContext);
}

/**
 * Registriert einen Event-Listener auf der aktuellen Socket-Verbindung und räumt
 * ihn beim Unmount bzw. Verbindungswechsel wieder auf. Der Callback darf sich bei
 * jedem Render ändern, ohne den Listener neu zu registrieren.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
