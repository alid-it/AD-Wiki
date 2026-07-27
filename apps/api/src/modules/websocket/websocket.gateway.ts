import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { SOCKET_EVENTS, SOCKET_ROOMS, type PresenceUser } from "@ad-wiki/shared-types";
import { AuthService } from "@/modules/auth/auth.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { NotificationService } from "@/modules/websocket/notification.service";

/** An `socket.data` gehaltener Zustand einer Verbindung. */
interface SocketState {
  user: AuthenticatedUser;
  /** IDs der Seiten, die diese Verbindung aktuell betrachtet. */
  pages: Set<string>;
}

/**
 * WebSocket-Gateway auf demselben HTTP-Server wie die REST-API (Port 4000,
 * Pfad /socket.io). Authentifiziert Verbindungen per JWT beim Handshake und
 * verwaltet Räume für globale Notifications sowie seitenbezogene Presence.
 *
 * CORS ist – wie bei der REST-API – permissiv gesetzt (Origin wird reflektiert).
 */
@WebSocketGateway({ cors: { origin: websocketOrigins(), credentials: true } })
export class WebsocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  /**
   * Presence-Registry: pageId → (socketId → User). Bewusst separat gehalten,
   * statt `fetchSockets()` zu nutzen – dessen serialisierte `socket.data` würde
   * das nicht-serialisierbare `pages`-Set nicht sauber übertragen.
   */
  private readonly pageMembers = new Map<string, Map<string, AuthenticatedUser>>();

  constructor(
    private readonly authService: AuthService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Nach der Initialisierung: Server an NotificationService binden und eine
   * Auth-Middleware registrieren.
   *
   * Die Middleware läuft VOR dem `connect`-Event und vor jeder Nachricht, sodass
   * `socket.data.user` garantiert gesetzt ist, bevor der Client Events sendet
   * (verhindert eine Race Condition bei sofortigem `join:page`).
   */
  afterInit(server: Server): void {
    this.notifications.bindServer(server);

    server.use((socket, next) => {
      const token = extractToken(socket);
      if (!token) {
        next(new Error("Unauthorized: kein Token übermittelt."));
        return;
      }
      void this.authService
        .verifyAccessToken(token)
        .then((user) => {
          if (!user) {
            next(new Error("Unauthorized: ungültiger oder abgelaufener Token."));
            return;
          }
          const state: SocketState = { user, pages: new Set() };
          socket.data = state;
          next();
        })
        .catch(() => next(new Error("Unauthorized")));
    });
  }

  /** Verbindung steht (Auth ist in der Middleware erfolgt) → global beitreten. */
  async handleConnection(client: Socket): Promise<void> {
    const state = client.data as SocketState | undefined;
    if (!state?.user) {
      client.disconnect(true);
      return;
    }
    await client.join(SOCKET_ROOMS.global);
    await client.join(SOCKET_ROOMS.user(state.user.id));
    await client.join(SOCKET_ROOMS.role(state.user.role));
  }

  /** Trennung: alle betrachteten Seiten über den Weggang informieren. */
  handleDisconnect(client: Socket): void {
    const state = client.data as SocketState | undefined;
    if (!state?.user) return;
    for (const pageId of state.pages) {
      this.removeMember(pageId, client.id);
      this.broadcastPresence(SOCKET_EVENTS.userLeft, pageId, state.user);
    }
  }

  /** Client betritt eine Seite → Presence aktualisieren. */
  @SubscribeMessage(SOCKET_EVENTS.joinPage)
  async onJoinPage(
    @ConnectedSocket() client: Socket,
    @MessageBody() pageId: string,
  ): Promise<void> {
    const state = client.data as SocketState | undefined;
    if (!state?.user || typeof pageId !== "string" || pageId.length === 0) return;

    await client.join(SOCKET_ROOMS.page(pageId));
    state.pages.add(pageId);
    this.addMember(pageId, client.id, state.user);
    this.broadcastPresence(SOCKET_EVENTS.userJoined, pageId, state.user);
  }

  /** Client verlässt eine Seite → Presence aktualisieren. */
  @SubscribeMessage(SOCKET_EVENTS.leavePage)
  async onLeavePage(
    @ConnectedSocket() client: Socket,
    @MessageBody() pageId: string,
  ): Promise<void> {
    const state = client.data as SocketState | undefined;
    if (!state?.user || typeof pageId !== "string") return;

    await client.leave(SOCKET_ROOMS.page(pageId));
    state.pages.delete(pageId);
    this.removeMember(pageId, client.id);
    this.broadcastPresence(SOCKET_EVENTS.userLeft, pageId, state.user);
  }

  /** Client signalisiert, dass er die Seite (nicht) bearbeitet. */
  @SubscribeMessage(SOCKET_EVENTS.setEditing)
  onSetEditing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pageId?: string; editing?: boolean },
  ): void {
    const state = client.data as SocketState | undefined;
    if (!state?.user || !body || typeof body.pageId !== "string") return;

    // Nur die anderen Betrachter benachrichtigen, nicht den Absender selbst.
    client.to(SOCKET_ROOMS.page(body.pageId)).emit(SOCKET_EVENTS.pageEditing, {
      pageId: body.pageId,
      user: toPresence(state.user),
      editing: Boolean(body.editing),
    });
  }

  /** Fügt einen Betrachter zur Presence-Registry einer Seite hinzu. */
  private addMember(pageId: string, socketId: string, user: AuthenticatedUser): void {
    let members = this.pageMembers.get(pageId);
    if (!members) {
      members = new Map();
      this.pageMembers.set(pageId, members);
    }
    members.set(socketId, user);
  }

  /** Entfernt einen Betrachter aus der Presence-Registry einer Seite. */
  private removeMember(pageId: string, socketId: string): void {
    const members = this.pageMembers.get(pageId);
    if (!members) return;
    members.delete(socketId);
    if (members.size === 0) this.pageMembers.delete(pageId);
  }

  /** Aktuelle, nach User-ID deduplizierte Roster einer Seite. */
  private rosterOf(pageId: string): PresenceUser[] {
    const members = this.pageMembers.get(pageId);
    if (!members) return [];
    // Mehrere Tabs/Verbindungen desselben Users zählen als eine Person.
    const unique = new Map<string, PresenceUser>();
    for (const user of members.values()) {
      unique.set(user.id, toPresence(user));
    }
    return [...unique.values()];
  }

  /**
   * Sendet das Presence-Event mit der aktuellen Roster an alle Betrachter der
   * Seite. Registry-Mutationen (add/remove) müssen vorher erfolgt sein.
   */
  private broadcastPresence(
    event: typeof SOCKET_EVENTS.userJoined | typeof SOCKET_EVENTS.userLeft,
    pageId: string,
    actor: AuthenticatedUser,
  ): void {
    this.server.to(SOCKET_ROOMS.page(pageId)).emit(event, {
      pageId,
      user: toPresence(actor),
      users: this.rosterOf(pageId),
    });
  }
}

/** Extrahiert den Access-Token aus `auth.token` oder `query.token` des Handshakes. */
function extractToken(client: Socket): string | null {
  const authToken = client.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.length > 0) return authToken;

  const queryToken = client.handshake.query?.token;
  if (typeof queryToken === "string" && queryToken.length > 0) return queryToken;
  if (Array.isArray(queryToken) && typeof queryToken[0] === "string") return queryToken[0];

  return null;
}

/** Reduziert einen authentifizierten User auf die öffentlich sichtbaren Presence-Felder. */
function toPresence(user: AuthenticatedUser): PresenceUser {
  return { id: user.id, displayName: user.displayName };
}

function websocketOrigins(): string[] {
  return (process.env.CORS_ALLOWED_ORIGINS ?? process.env.WEB_URL ?? "http://localhost:3000")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
