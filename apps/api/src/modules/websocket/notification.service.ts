import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import {
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  type AccessControlChangeAction,
  type AccessControlChangeScope,
  type NotificationType,
  type PresenceUser,
  type WikiNotification,
} from "@ad-wiki/shared-types";

/** Kompakte Seiten-Info, wie sie die Controller nach einer Mutation besitzen. */
interface PageRef {
  id: string;
  title: string;
  slug: string;
  type?: "folder" | "page";
}

/** Kompakte Kategorie-Info. */
interface CategoryRef {
  id: string;
  name: string;
  slug: string;
}

/** Kompakte Medien-Info. */
interface MediaRef {
  id: string;
  filename: string;
}

interface NoteRef {
  id: string;
  title: string | null;
}

/**
 * Zentraler Dienst zum Versenden von Live-Notifications über WebSockets.
 * Andere Module (bzw. deren Controller) rufen die `notify*`-Methoden auf.
 *
 * Die Socket.IO-`Server`-Instanz wird nach der Gateway-Initialisierung per
 * {@link bindServer} gesetzt – dadurch hängt dieser Service NICHT vom Gateway ab
 * und es entsteht kein zirkulärer Abhängigkeitsgraph.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private server: Server | null = null;

  /** Wird vom WebsocketGateway in `afterInit` aufgerufen. */
  bindServer(server: Server): void {
    this.server = server;
    this.logger.log("Socket.IO-Server an NotificationService gebunden.");
  }

  /**
   * Sendet ein beliebiges Event an einen Raum. Ohne Raum-Angabe geht es an
   * alle authentifizierten Verbindungen (`wiki:global`).
   */
  notify(event: string, data: unknown, room: string = SOCKET_ROOMS.global): void {
    if (!this.server) return; // WebSocket noch nicht initialisiert – still ignorieren.
    this.server.to(room).emit(event, data);
  }

  // ── Konkrete Notification-Auslöser ───────────────────────────────

  notifyPageCreated(page: PageRef, actor: PresenceUser): void {
    this.notify(SOCKET_EVENTS.pageCreated, {
      pageId: page.id,
      slug: page.slug,
      title: page.title,
      type: page.type ?? "page",
      actor,
    });
    this.emitNotification("info", `${actor.displayName} hat die Seite „${page.title}" erstellt.`, {
      resource: "page",
      resourceId: page.id,
      slug: page.slug,
      actor,
    });
  }

  notifyPageUpdated(page: PageRef, actor: PresenceUser): void {
    this.emitNotification("info", `${actor.displayName} hat „${page.title}" bearbeitet.`, {
      resource: "page",
      resourceId: page.id,
      slug: page.slug,
      actor,
    });
    // Betrachter der Seite gezielt informieren (z. B. für einen Reload-Hinweis).
    this.notify(
      SOCKET_EVENTS.pageUpdated,
      { pageId: page.id, slug: page.slug, title: page.title, actor },
      SOCKET_ROOMS.page(page.id),
    );
  }

  notifyPageDeleted(pageTitle: string, actor: PresenceUser): void {
    this.emitNotification("warning", `${actor.displayName} hat die Seite „${pageTitle}" gelöscht.`, {
      resource: "page",
      actor,
    });
  }

  notifyCategoryCreated(category: CategoryRef, actor: PresenceUser): void {
    this.emitNotification("info", `Neue Kategorie „${category.name}" erstellt.`, {
      resource: "category",
      resourceId: category.id,
      slug: category.slug,
      actor,
    });
  }

  notifyCategoryUpdated(category: CategoryRef, actor: PresenceUser): void {
    this.emitNotification("info", `Kategorie „${category.name}" bearbeitet.`, {
      resource: "category",
      resourceId: category.id,
      slug: category.slug,
      actor,
    });
  }

  notifyCategoryDeleted(categoryName: string, actor: PresenceUser): void {
    this.emitNotification("warning", `Kategorie „${categoryName}" gelöscht.`, {
      resource: "category",
      actor,
    });
  }

  notifyMediaUploaded(media: MediaRef, actor: PresenceUser): void {
    this.emitNotification("success", `${actor.displayName} hat „${media.filename}" hochgeladen.`, {
      resource: "media",
      resourceId: media.id,
      actor,
    });
  }

  notifyMediaDeleted(filename: string, actor: PresenceUser): void {
    this.emitNotification("warning", `${actor.displayName} hat „${filename}" gelöscht.`, {
      resource: "media",
      actor,
    });
  }

  notifyUserRegistered(user: PresenceUser): void {
    this.emitNotification("info", `${user.displayName} hat sich registriert.`, {
      resource: "user",
      resourceId: user.id,
      actor: user,
    });
  }

  /** Meldet fehlgeschlagene Sicherungen ausschliesslich an Administratoren. */
  notifyBackupFailed(jobId: string, errorCode: string | null): void {
    const suffix = errorCode ? ` (${errorCode})` : "";
    this.emitNotification("error", `Backup fehlgeschlagen${suffix}.`, {
      resource: "backups",
      resourceId: jobId,
    }, SOCKET_ROOMS.role("admin"));
  }

  /** Signals clients to reload their effective ACLs. No permission details are broadcast. */
  notifyPermissionsUpdated(
    scope: AccessControlChangeScope = "permissions",
    action: AccessControlChangeAction = "updated",
  ): void {
    this.notify(SOCKET_EVENTS.permissionsUpdated, { scope, action });
  }

  /** Private Notes-Events gehen ausschlieÃŸlich an EigentÃ¼mer und FreigabeempfÃ¤nger. */
  notifyNoteChanged(
    note: NoteRef,
    actor: PresenceUser,
    action: "created" | "updated" | "deleted" | "restored" | "shared",
    userIds: string[],
  ): void {
    const label = note.title?.trim() || "Notiz";
    const messages = {
      created: `${actor.displayName} hat â€ž${label}" erfasst.`,
      updated: `${actor.displayName} hat â€ž${label}" bearbeitet.`,
      deleted: `${actor.displayName} hat â€ž${label}" gelÃ¶scht.`,
      restored: `${actor.displayName} hat â€ž${label}" wiederhergestellt.`,
      shared: `${actor.displayName} hat â€ž${label}" geteilt.`,
    } as const;
    for (const userId of new Set(userIds)) {
      const room = SOCKET_ROOMS.user(userId);
      this.notify(SOCKET_EVENTS.notesChanged, { noteId: note.id, action, actor }, room);
      this.emitNotification(action === "deleted" ? "warning" : "info", messages[action], {
        resource: "note",
        resourceId: note.id,
        actor,
      }, room);
    }
  }

  /** Inhalt wird nicht übertragen; berechtigte Clients laden die Richtlinien neu. */
  notifyStandardChanged(
    standardId: string,
    action: "created" | "updated" | "deleted" | "submitted" | "approved" | "deprecated" | "exception",
    actor: PresenceUser,
  ): void {
    this.notify(SOCKET_EVENTS.standardsChanged, { standardId, action, actor });
  }

  // ── Intern ───────────────────────────────────────────────────────

  /** Baut eine {@link WikiNotification} und sendet sie global an alle Clients. */
  private emitNotification(
    type: NotificationType,
    message: string,
    extra: Partial<Omit<WikiNotification, "id" | "type" | "message" | "createdAt">> = {},
    room: string = SOCKET_ROOMS.global,
  ): void {
    const notification: WikiNotification = {
      id: randomUUID(),
      type,
      message,
      createdAt: new Date().toISOString(),
      ...extra,
    };
    this.notify(SOCKET_EVENTS.notification, notification, room);
  }
}
