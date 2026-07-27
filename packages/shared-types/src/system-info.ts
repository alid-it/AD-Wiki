import { z } from 'zod';

/** Einheitliche Zustandsstufen für die Betriebsübersicht. */
export const SystemHealthStatusSchema = z.enum(['healthy', 'warning', 'critical', 'unknown']);
export type SystemHealthStatus = z.infer<typeof SystemHealthStatusSchema>;

/** Abhängigkeit, die von der API direkt geprüft werden kann. */
export const SystemDependencySchema = z.object({
  id: z.enum(['api', 'database', 'redis']),
  status: SystemHealthStatusSchema,
  latencyMs: z.number().nonnegative().nullable(),
  mode: z.enum(['native', 'memory']).optional(),
});
export type SystemDependency = z.infer<typeof SystemDependencySchema>;

/** Zusammenfassung des Sicherungszustands für Menschen und Monitoring-Clients. */
export const SystemBackupStatusSchema = z.object({
  status: SystemHealthStatusSchema,
  activeJobs: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  runningJobs: z.number().int().nonnegative(),
  oldestQueuedAgeSeconds: z.number().int().nonnegative().nullable(),
  failureCount: z.number().int().nonnegative(),
  enabledPlans: z.number().int().nonnegative(),
  overduePlans: z.number().int().nonnegative(),
  availableArtifacts: z.number().int().nonnegative(),
  workerAvailable: z.boolean(),
  workerLastSeenAt: z.string().datetime().nullable(),
  workerHeartbeatAgeSeconds: z.number().int().nonnegative().nullable(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastSuccessAgeSeconds: z.number().int().nonnegative().nullable(),
  lastDurationSeconds: z.number().nonnegative().nullable(),
  lastSizeBytes: z.string().regex(/^\d+$/).nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  lastFailureCode: z.string().nullable(),
  latestFailureOpen: z.boolean(),
  stale: z.boolean(),
});
export type SystemBackupStatus = z.infer<typeof SystemBackupStatusSchema>;

/** Öffentliches TLS-Zertifikat ohne geheime Schlüssel- oder Dateiinhalte. */
export const SystemCertificateStatusSchema = z.object({
  status: SystemHealthStatusSchema,
  subject: z.string().nullable(),
  issuer: z.string().nullable(),
  validFrom: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  daysRemaining: z.number().int().nullable(),
  fingerprintSha256: z.string().nullable(),
  subjectAltName: z.string().nullable(),
  selfSigned: z.boolean().nullable(),
});
export type SystemCertificateStatus = z.infer<typeof SystemCertificateStatusSchema>;

/** Kapazität des von der API verwendeten Upload-Volumes. */
export const SystemCapacityStatusSchema = z.object({
  status: SystemHealthStatusSchema,
  mediaCount: z.number().int().nonnegative(),
  mediaTotalBytes: z.string().regex(/^\d+$/),
  uploadFilesystemSizeBytes: z.string().regex(/^\d+$/).nullable(),
  uploadFilesystemFreeBytes: z.string().regex(/^\d+$/).nullable(),
  uploadFilesystemFreePercent: z.number().min(0).max(100).nullable(),
});
export type SystemCapacityStatus = z.infer<typeof SystemCapacityStatusSchema>;

/** Versandzustand ohne Empfänger, Zugangsdaten oder Mailinhalte. */
export const SystemSmtpStatusSchema = z.object({
  status: SystemHealthStatusSchema,
  configured: z.boolean(),
  enabled: z.boolean(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  latestFailureOpen: z.boolean(),
});
export type SystemSmtpStatus = z.infer<typeof SystemSmtpStatusSchema>;

/** Zustand des internen Audit-Schreibpfads ohne Audit-Nutzdaten. */
export const SystemAuditStatusSchema = z.object({
  status: SystemHealthStatusSchema,
  databaseReadable: z.boolean(),
  totalEntries: z.number().int().nonnegative(),
  lastEntryAt: z.string().datetime().nullable(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  latestFailureOpen: z.boolean(),
});
export type SystemAuditStatus = z.infer<typeof SystemAuditStatusSchema>;

/** Sicherheitsereignisse ohne Benutzer-, IP-, Routen- oder Tokenlabels. */
export const SystemSecurityStatusSchema = z.object({
  status: SystemHealthStatusSchema,
  loginSuccessCount: z.number().int().nonnegative(),
  loginFailureCount: z.number().int().nonnegative(),
  unauthorizedCount: z.number().int().nonnegative(),
  forbiddenCount: z.number().int().nonnegative(),
  rateLimitedCount: z.number().int().nonnegative(),
  apiKeySuccessCount: z.number().int().nonnegative(),
  apiKeyFailureCount: z.number().int().nonnegative(),
  mcpAuthSuccessCount: z.number().int().nonnegative(),
  mcpAuthFailureCount: z.number().int().nonnegative(),
  mcpRequestSuccessCount: z.number().int().nonnegative(),
  mcpRequestFailureCount: z.number().int().nonnegative(),
  mcpRateLimitedCount: z.number().int().nonnegative(),
  lastEventAt: z.string().datetime().nullable(),
});
export type SystemSecurityStatus = z.infer<typeof SystemSecurityStatusSchema>;

/** Geschützte, strukturierte Betriebsübersicht für die Settings-Seite. */
export const SystemInfoSchema = z.object({
  status: z.enum(['healthy', 'warning', 'critical']),
  generatedAt: z.string().datetime(),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  staleBackupAfterHours: z.number().positive(),
  services: z.array(SystemDependencySchema),
  backup: SystemBackupStatusSchema,
  certificate: SystemCertificateStatusSchema,
  capacity: SystemCapacityStatusSchema,
  smtp: SystemSmtpStatusSchema,
  audit: SystemAuditStatusSchema,
  security: SystemSecurityStatusSchema,
  monitoring: z.object({
    livePath: z.string(),
    readyPath: z.string(),
    metricsPath: z.string(),
    metricsProtected: z.boolean(),
    prometheusCompatible: z.literal(true),
    zabbixCompatible: z.literal(true),
  }),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
