import { z } from 'zod';

export const BackupDestinationTypeSchema = z.enum([
  'local',
  'sftp',
  's3',
]);
export type BackupDestinationType = z.infer<typeof BackupDestinationTypeSchema>;

export const BackupJobOperationSchema = z.enum([
  'backup',
  'verify',
  'connection_test',
  'restore_preflight',
]);
export type BackupJobOperation = z.infer<typeof BackupJobOperationSchema>;

export const BackupJobTriggerSchema = z.enum(['manual', 'scheduled']);
export type BackupJobTrigger = z.infer<typeof BackupJobTriggerSchema>;

export const BackupJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type BackupJobStatus = z.infer<typeof BackupJobStatusSchema>;

export const RestorePreflightSecretKeySchema = z.enum([
  'database',
  'uploads',
  'restore_mount',
  'source_credentials',
]);
export type RestorePreflightSecretKey = z.infer<typeof RestorePreflightSecretKeySchema>;

export const RestorePreflightSecretSchema = z.object({
  key: RestorePreflightSecretKeySchema,
  required: z.boolean(),
  configured: z.boolean(),
}).strict();
export type RestorePreflightSecret = z.infer<typeof RestorePreflightSecretSchema>;

export const RestorePreflightStorageSchema = z.object({
  requiredBytes: z.string().regex(/^\d+$/),
  availableBytes: z.string().regex(/^\d+$/),
  sufficient: z.boolean(),
}).strict();
export type RestorePreflightStorage = z.infer<typeof RestorePreflightStorageSchema>;

export const RestorePreflightResultSchema = z.object({
  backupId: z.string().uuid(),
  formatVersion: z.literal(1),
  backupCreatedAt: z.string().datetime(),
  restorePath: z.string().min(1).max(1500),
  integrityVerified: z.boolean(),
  databaseArchiveReadable: z.boolean(),
  uploadsArchiveReadable: z.boolean(),
  compatibility: z.enum(['compatible', 'incompatible']),
  secrets: z.array(RestorePreflightSecretSchema).min(3).max(4),
  storage: RestorePreflightStorageSchema,
  ready: z.boolean(),
  checkedAt: z.string().datetime(),
}).strict();
export type RestorePreflightResult = z.infer<typeof RestorePreflightResultSchema>;

export const RestoreRunbookStepSchema = z.object({
  key: z.enum(['review', 'dry_run', 'stop', 'restore', 'start', 'verify']),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  command: z.string().min(1).max(2000).nullable(),
  danger: z.boolean(),
}).strict();
export type RestoreRunbookStep = z.infer<typeof RestoreRunbookStepSchema>;

export const RestoreRunbookSchema = z.object({
  sourceJobId: z.string().uuid(),
  preflightJobId: z.string().uuid(),
  backupId: z.string().uuid(),
  restorePath: z.string().min(1).max(1500),
  generatedAt: z.string().datetime(),
  steps: z.array(RestoreRunbookStepSchema).length(6),
}).strict();
export type RestoreRunbook = z.infer<typeof RestoreRunbookSchema>;

const NameSchema = z.string().trim().min(1).max(100);
const HostSchema = z.string().trim().min(1).max(253).regex(
  /^(?:\[[0-9A-Fa-f:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)$/,
  'Ungültiger Hostname oder ungültige IP-Adresse.',
);
const MountNameSchema = z.string().trim().min(1).max(64).regex(
  /^[a-z0-9][a-z0-9_-]*$/,
  'Mount-Namen dürfen nur Kleinbuchstaben, Zahlen, Unterstriche und Bindestriche enthalten.',
);
const RelativePathSchema = z.string().trim().max(500).refine(
  (value) => {
    if (value === '') return true;
    if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\') || value.includes('\0')) {
      return false;
    }
    return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  },
  { message: 'Der Pfad muss relativ sein und darf keine Traversal-Segmente enthalten.' },
);
const RemotePathSchema = z.string().trim().min(1).max(1000).refine(
  (value) => !value.includes('\0') && !value.includes('\\') && value.split('/').every((segment) => segment !== '..'),
  { message: 'Der Remote-Pfad enthält unzulässige Segmente.' },
);

export const MountedBackupConfigSchema = z.object({
  mountName: MountNameSchema,
  subdirectory: RelativePathSchema.default(''),
}).strict();
export type MountedBackupConfig = z.infer<typeof MountedBackupConfigSchema>;

export const SftpBackupConfigSchema = z.object({
  host: HostSchema,
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(255),
  basePath: RemotePathSchema,
  hostKeyFingerprint: z.string().trim().max(255).refine(
    (value) => /^SHA256:[A-Za-z0-9+/]{43}=?$/.test(value) || /^[a-f0-9]{64}$/i.test(value),
    { message: 'Der Host-Key-Fingerprint muss als SHA256:Base64 oder SHA-256-Hex angegeben werden.' },
  ),
}).strict();
export type SftpBackupConfig = z.infer<typeof SftpBackupConfigSchema>;

export const SftpBackupCredentialsSchema = z.object({
  password: z.string().min(1).max(1000).optional(),
  privateKey: z.string().min(1).max(100_000).optional(),
  passphrase: z.string().min(1).max(1000).optional(),
}).strict().refine(
  (value) => Boolean(value.password || value.privateKey),
  { message: 'Für SFTP ist ein Passwort oder ein privater Schlüssel erforderlich.' },
);
export type SftpBackupCredentials = z.infer<typeof SftpBackupCredentialsSchema>;

export const S3BackupConfigSchema = z.object({
  endpoint: z.string().url().max(2000)
    .refine((value) => value.startsWith('https://'), {
      message: 'Der S3-Endpunkt muss HTTPS verwenden.',
    })
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    }, {
      message: 'Der S3-Endpunkt darf keine Zugangsdaten, Query-Parameter oder Fragmente enthalten.',
    }),
  region: z.string().trim().min(1).max(100),
  bucket: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  prefix: RelativePathSchema.default(''),
  forcePathStyle: z.boolean().default(false),
  serverSideEncryption: z.enum(['AES256', 'aws:kms']).default('AES256'),
  kmsKeyId: z.string().trim().min(1).max(2048).optional(),
}).strict().superRefine((value, context) => {
  if (value.serverSideEncryption === 'aws:kms' && !value.kmsKeyId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kmsKeyId'],
      message: 'Für AWS-KMS muss eine KMS-Schlüssel-ID angegeben werden.',
    });
  }
});
export type S3BackupConfig = z.infer<typeof S3BackupConfigSchema>;

export const S3BackupCredentialsSchema = z.object({
  accessKeyId: z.string().min(1).max(1000),
  secretAccessKey: z.string().min(1).max(2000),
  sessionToken: z.string().min(1).max(10_000).optional(),
}).strict();
export type S3BackupCredentials = z.infer<typeof S3BackupCredentialsSchema>;

const LocalDestinationInputSchema = z.object({
  type: z.literal('local'),
  config: MountedBackupConfigSchema,
}).strict();
const SftpDestinationInputSchema = z.object({
  type: z.literal('sftp'),
  config: SftpBackupConfigSchema,
  credentials: SftpBackupCredentialsSchema.optional(),
}).strict();
const S3DestinationInputSchema = z.object({
  type: z.literal('s3'),
  config: S3BackupConfigSchema,
  credentials: S3BackupCredentialsSchema.optional(),
}).strict();
export const BackupDestinationSettingsInputSchema = z.discriminatedUnion('type', [
  LocalDestinationInputSchema,
  SftpDestinationInputSchema,
  S3DestinationInputSchema,
]);
export type BackupDestinationSettingsInput = z.infer<typeof BackupDestinationSettingsInputSchema>;

export const CreateBackupDestinationSchema = z.object({
  name: NameSchema,
  isEnabled: z.boolean().default(true),
  settings: BackupDestinationSettingsInputSchema,
}).strict().superRefine((input, context) => {
  if (
    (input.settings.type === 'sftp' || input.settings.type === 's3') &&
    !input.settings.credentials
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settings', 'credentials'],
      message: 'Für ein neues Remote-Ziel sind Zugangsdaten erforderlich.',
    });
  }
});
export type CreateBackupDestinationInput = z.infer<typeof CreateBackupDestinationSchema>;

export const UpdateBackupDestinationSchema = z.object({
  name: NameSchema.optional(),
  isEnabled: z.boolean().optional(),
  settings: BackupDestinationSettingsInputSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Mindestens ein Feld muss geändert werden.',
});
export type UpdateBackupDestinationInput = z.infer<typeof UpdateBackupDestinationSchema>;

const BackupDestinationBaseSchema = z.object({
  id: z.string().uuid(),
  name: NameSchema,
  isEnabled: z.boolean(),
  hasCredentials: z.boolean(),
  lastTestedAt: z.string().datetime().nullable(),
  lastTestSucceeded: z.boolean().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const BackupDestinationSchema = z.discriminatedUnion('type', [
  BackupDestinationBaseSchema.extend({ type: z.literal('local'), config: MountedBackupConfigSchema }),
  BackupDestinationBaseSchema.extend({ type: z.literal('sftp'), config: SftpBackupConfigSchema }),
  BackupDestinationBaseSchema.extend({ type: z.literal('s3'), config: S3BackupConfigSchema }),
]);
export type BackupDestination = z.infer<typeof BackupDestinationSchema>;

export const BackupDestinationReferenceSchema = z.object({
  id: z.string().uuid(),
  name: NameSchema,
  type: BackupDestinationTypeSchema,
  isEnabled: z.boolean(),
}).strict();
export type BackupDestinationReference = z.infer<typeof BackupDestinationReferenceSchema>;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const BackupScheduleSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().trim().min(1).max(100).refine(isValidTimeZone, {
    message: 'Unbekannte IANA-Zeitzone.',
  }),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
    .transform((days) => [...new Set(days)].sort((left, right) => left - right)),
}).strict();
export type BackupSchedule = z.infer<typeof BackupScheduleSchema>;

export const BackupRetentionSchema = z.object({
  daily: z.number().int().min(0).max(365).default(7),
  weekly: z.number().int().min(0).max(104).default(4),
  monthly: z.number().int().min(0).max(120).default(6),
}).strict().refine((value) => value.daily + value.weekly + value.monthly > 0, {
  message: 'Mindestens eine Sicherung muss aufbewahrt werden.',
});
export type BackupRetention = z.infer<typeof BackupRetentionSchema>;

export const CreateBackupPlanSchema = z.object({
  name: NameSchema,
  enabled: z.boolean().default(false),
  destinationId: z.string().uuid(),
  schedule: BackupScheduleSchema,
  retention: BackupRetentionSchema,
}).strict();
export type CreateBackupPlanInput = z.infer<typeof CreateBackupPlanSchema>;

export const UpdateBackupPlanSchema = z.object({
  name: NameSchema.optional(),
  enabled: z.boolean().optional(),
  destinationId: z.string().uuid().optional(),
  schedule: BackupScheduleSchema.optional(),
  retention: BackupRetentionSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Mindestens ein Feld muss geändert werden.',
});
export type UpdateBackupPlanInput = z.infer<typeof UpdateBackupPlanSchema>;

export const BackupPlanSchema = z.object({
  id: z.string().uuid(),
  name: NameSchema,
  enabled: z.boolean(),
  destination: BackupDestinationReferenceSchema,
  schedule: BackupScheduleSchema,
  retention: BackupRetentionSchema,
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type BackupPlan = z.infer<typeof BackupPlanSchema>;

export const BackupJobSchema = z.object({
  id: z.string().uuid(),
  operation: BackupJobOperationSchema,
  trigger: BackupJobTriggerSchema,
  status: BackupJobStatusSchema,
  planId: z.string().uuid().nullable(),
  destinationId: z.string().uuid().nullable(),
  sourceJobId: z.string().uuid().nullable(),
  requestedById: z.string().uuid().nullable(),
  scheduledFor: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  artifactSize: z.string().regex(/^\d+$/).nullable(),
  artifactAvailable: z.boolean(),
  artifactPath: z.string().max(1500).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  errorCode: z.string().max(100).nullable(),
  errorMessage: z.string().max(1000).nullable(),
  restorePreflight: RestorePreflightResultSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type BackupJob = z.infer<typeof BackupJobSchema>;

export const BackupHealthStatusSchema = z.enum(['healthy', 'warning', 'running', 'never']);
export type BackupHealthStatus = z.infer<typeof BackupHealthStatusSchema>;

export const BackupOverviewSchema = z.object({
  status: BackupHealthStatusSchema,
  activeJob: BackupJobSchema.nullable(),
  lastSuccessfulJob: BackupJobSchema.nullable(),
  latestFailedJob: BackupJobSchema.nullable(),
  nextRunAt: z.string().datetime().nullable(),
  enabledPlans: z.number().int().nonnegative(),
  availableArtifacts: z.number().int().nonnegative(),
}).strict();
export type BackupOverview = z.infer<typeof BackupOverviewSchema>;

export const StartBackupJobSchema = z.union([
  z.object({ destinationId: z.string().uuid() }).strict(),
  z.object({ planId: z.string().uuid() }).strict(),
]);
export type StartBackupJobInput = z.infer<typeof StartBackupJobSchema>;
