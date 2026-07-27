import { z } from 'zod';

/**
 * Geteilte Typen für die WebSocket-Kommunikation (Live-Notifications & Presence).
 * Backend (NestJS-Gateway) und Frontend (socket.io-client) nutzen dieselben
 * Definitionen, damit Events und Payloads nie auseinanderlaufen.
 */

/** Toast-Stil einer Notification. */
export const NotificationType = z.enum(['success', 'info', 'warning', 'error']);
export type NotificationType = z.infer<typeof NotificationType>;

/** Ressourcen-Typ, auf den sich eine Notification bezieht (für die Navigation). */
export const NotificationResource = z.enum(['page', 'category', 'media', 'note', 'standard', 'user', 'backups']);
export type NotificationResource = z.infer<typeof NotificationResource>;

/** Kompakte Info über den auslösenden Benutzer. */
export const PresenceUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});
export type PresenceUser = z.infer<typeof PresenceUserSchema>;

/** Eine Live-Notification (Server → Client, Event "notification"). */
export const WikiNotificationSchema = z.object({
  id: z.string(),
  type: NotificationType,
  message: z.string(),
  resource: NotificationResource.nullable().optional(),
  resourceId: z.string().nullable().optional(),
  /** Ziel-Slug für die Navigation (z. B. Seiten- oder Kategorie-Slug). */
  slug: z.string().nullable().optional(),
  actor: PresenceUserSchema.nullable().optional(),
  createdAt: z.string(),
});
export type WikiNotification = z.infer<typeof WikiNotificationSchema>;

/** Payload des Events "page:updated" (an Betrachter einer Seite). */
export const PageUpdatedEventSchema = z.object({
  pageId: z.string(),
  slug: z.string(),
  title: z.string(),
  actor: PresenceUserSchema.nullable(),
});
export type PageUpdatedEvent = z.infer<typeof PageUpdatedEventSchema>;

/** Payload des globalen Events "page.created" fuer Seiten und Ordner. */
export const PageCreatedEventSchema = z.object({
  pageId: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  type: z.enum(['folder', 'page']),
  actor: PresenceUserSchema,
});
export type PageCreatedEvent = z.infer<typeof PageCreatedEventSchema>;

/** Payload der Presence-Events "user:joined" / "user:left". */
export const PagePresenceEventSchema = z.object({
  pageId: z.string(),
  /** Der Benutzer, der die Änderung ausgelöst hat. */
  user: PresenceUserSchema,
  /** Aktuelle Liste aller Benutzer auf der Seite (dedupliziert). */
  users: z.array(PresenceUserSchema),
});
export type PagePresenceEvent = z.infer<typeof PagePresenceEventSchema>;

/** Payload des Events "page:editing" (jemand bearbeitet die Seite). */
export const PageEditingEventSchema = z.object({
  pageId: z.string(),
  user: PresenceUserSchema,
  editing: z.boolean(),
});
export type PageEditingEvent = z.infer<typeof PageEditingEventSchema>;

export const NoteChangedEventSchema = z.object({
  noteId: z.string().uuid(),
  action: z.enum(['created', 'updated', 'deleted', 'restored', 'shared']),
  actor: PresenceUserSchema,
});
export type NoteChangedEvent = z.infer<typeof NoteChangedEventSchema>;

export const StandardChangedEventSchema = z.object({
  standardId: z.string().uuid(),
  action: z.enum(['created', 'updated', 'deleted', 'submitted', 'approved', 'deprecated', 'exception']),
  actor: PresenceUserSchema,
});
export type StandardChangedEvent = z.infer<typeof StandardChangedEventSchema>;

export const AccessControlChangeScopeSchema = z.enum([
  'permissions',
  'groups',
  'spaces',
  'resource_acls',
]);
export type AccessControlChangeScope = z.infer<
  typeof AccessControlChangeScopeSchema
>;

export const AccessControlChangeActionSchema = z.enum([
  'created',
  'updated',
  'deleted',
  'member_added',
  'member_updated',
  'member_removed',
  'boundary_set',
  'boundary_removed',
]);
export type AccessControlChangeAction = z.infer<
  typeof AccessControlChangeActionSchema
>;

/** Signalisiert, dass Clients ihre effektiven Zugriffe neu laden müssen. */
export const AccessControlChangedEventSchema = z.object({
  scope: AccessControlChangeScopeSchema,
  action: AccessControlChangeActionSchema,
});
export type AccessControlChangedEvent = z.infer<
  typeof AccessControlChangedEventSchema
>;

/** Namen aller Socket-Events (Single Source of Truth). */
export const SOCKET_EVENTS = {
  // Client → Server
  joinPage: 'join:page',
  leavePage: 'leave:page',
  setEditing: 'page:editing',
  // Server → Client
  notification: 'notification',
  pageCreated: 'page.created',
  pageUpdated: 'page:updated',
  pageEditing: 'page:editing',
  userJoined: 'user:joined',
  userLeft: 'user:left',
  permissionsUpdated: 'permissions:updated',
  notesChanged: 'notes:changed',
  standardsChanged: 'standards:changed',
} as const;

/** Raum-Namen für Broadcasts. */
export const SOCKET_ROOMS = {
  /** Alle authentifizierten Verbindungen (globale Notifications). */
  global: 'wiki:global',
  /** Betrachter einer bestimmten Seite. */
  page: (pageId: string): string => `wiki:page:${pageId}`,
  user: (userId: string): string => `wiki:user:${userId}`,
  role: (role: string): string => `wiki:role:${role}`,
} as const;
