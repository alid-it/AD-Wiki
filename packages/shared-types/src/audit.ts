import { z } from 'zod';

/**
 * Ressourcen-Typen, auf die sich ein Audit-Eintrag beziehen kann.
 * Wird in der Spalte `resource` (Singular) der audit_logs-Tabelle gespeichert.
 */
export const AUDIT_RESOURCES = [
  'user',
  'page',
  'category',
  'media',
  'acl',
  'permission',
  'setting',
  'standard',
  'mcp',
  'mcp_token',
  'export',
  'backup_destination',
  'backup_plan',
  'backup_job',
  'group',
  'space',
  'resource_acl',
  'identity_provider',
  'external_identity',
] as const;

export const AuditResource = z.enum(AUDIT_RESOURCES);
export type AuditResource = z.infer<typeof AuditResource>;

/**
 * Bekannte Aktionsnamen im Format `resource.verb`.
 * Wird in der Spalte `action` gespeichert. Die Liste ist die Single Source of
 * Truth für Backend (Logging) und Frontend (Filter-Dropdowns, Farbcodierung).
 */
export const AUDIT_ACTIONS = [
  // Auth / Benutzer
  'user.login',
  'user.logout',
  'user.registered',
  'user.role_changed',
  'user.deactivated',
  'user.activated',
  'user.jit_provisioned',
  // Externe Identitäten und Berechtigungssynchronisierung
  'identity.linked',
  'identity.unlinked',
  'identity.groups_synced',
  'identity.sync_failed',
  'identity_provider.created',
  'identity_provider.updated',
  'identity_provider.deleted',
  'identity_provider.connection_tested',
  'identity_mapping.created',
  'identity_mapping.deleted',
  // Seiten
  'page.created',
  'page.updated',
  'page.deleted',
  'page.restored',
  // Kategorien
  'category.created',
  'category.updated',
  'category.deleted',
  // Medien
  'media.uploaded',
  'media.deleted',
  // Rechte
  'acl.updated',
  'permission.updated',
  // Einstellungen
  'setting.updated',
  'standard.created',
  'standard.updated',
  'standard.deleted',
  'standard.submitted',
  'standard.approved',
  'standard.deprecated',
  'standard.exception_requested',
  'standard.exception_decided',
  // MCP-Zugriff
  'mcp.tool_called',
  'mcp_token.created',
  'mcp_token.revoked',
  // Exporte
  'export.wiki',
  // Backup-Konfiguration und spätere Ausführungen
  'backup_destination.created',
  'backup_destination.updated',
  'backup_destination.deleted',
  'backup_plan.created',
  'backup_plan.updated',
  'backup_plan.deleted',
  'backup_job.started',
  'backup_job.succeeded',
  'backup_job.failed',
  // Gruppen und Mitgliedschaften
  'group.created',
  'group.updated',
  'group.deleted',
  'group.member_added',
  'group.member_role_changed',
  'group.member_removed',
  // Wissensbereiche
  'space.created',
  'space.updated',
  'space.deleted',
  // Ressourcen-ACLs und Vererbungsgrenzen
  'resource_acl.created',
  'resource_acl.updated',
  'resource_acl.deleted',
  'resource_acl.boundary_set',
  'resource_acl.boundary_removed',
] as const;

export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

/** Kompakte Info über den auslösenden Benutzer (falls noch vorhanden). */
export const AuditActorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
});
export type AuditActor = z.infer<typeof AuditActorSchema>;

/** Ein Audit-Log-Eintrag, wie ihn `GET /audit-logs` ausliefert. */
export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  /** Aktionsname (z. B. `page.updated`). Siehe {@link AUDIT_ACTIONS}. */
  action: z.string(),
  /** Betroffene Ressource (z. B. `page`). Siehe {@link AUDIT_RESOURCES}. */
  resource: z.string(),
  /** ID des betroffenen Objekts (sofern zutreffend). */
  resourceId: z.string().nullable(),
  /** Zusatzkontext als JSON (z. B. Titel, geänderte Felder). */
  details: z.record(z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string().datetime(),
  userId: z.string().uuid().nullable(),
  /** Aufgelöster Benutzer; `null`, wenn der Benutzer inzwischen gelöscht wurde. */
  user: AuditActorSchema.nullable(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * Query-Parameter für die filterbare Audit-Log-Liste (`GET /audit-logs`).
 * Die Blätterung erfolgt Cursor-basiert (stabil auch bei neu hinzukommenden
 * Einträgen): `cursor` ist ein opaker Token, den die vorige Antwort als
 * `meta.nextCursor` geliefert hat. Alle Filter sind optional und kombinierbar.
 */
export const AuditLogQuerySchema = z.object({
  /** Filter nach Ressource (exakter Wert, z. B. `page`). */
  resource: z.string().optional(),
  /** Filter nach Aktion (exakter Wert, z. B. `page.updated`). */
  action: z.string().optional(),
  /** Filter nach auslösendem Benutzer. */
  userId: z.string().uuid().optional(),
  /** Untere Zeitgrenze (ISO-Datum, inklusive). */
  from: z.string().optional(),
  /** Obere Zeitgrenze (ISO-Datum, inklusive). */
  to: z.string().optional(),
  /** Opaker Cursor der nächsten Seite (aus `meta.nextCursor`). */
  cursor: z.string().optional(),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

/**
 * Meta-Block der Cursor-basierten Audit-Log-Liste. `nextCursor` ist `null`,
 * wenn keine weiteren Einträge folgen. `total` ist die Gesamtzahl der (nach den
 * aktiven Filtern) passenden Einträge – für die Anzeige „X Einträge".
 */
export const AuditLogPageMetaSchema = z.object({
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export type AuditLogPageMeta = z.infer<typeof AuditLogPageMetaSchema>;
