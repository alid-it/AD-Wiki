import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  BackupDestinationType as PrismaBackupDestinationType,
  BackupJobOperation as PrismaBackupJobOperation,
  BackupJobStatus as PrismaBackupJobStatus,
  BackupJobTrigger as PrismaBackupJobTrigger,
  Prisma,
  type BackupDestination as PrismaBackupDestination,
  type BackupJob as PrismaBackupJob,
} from "@prisma/client";
import {
  MountedBackupConfigSchema,
  S3BackupConfigSchema,
  SftpBackupConfigSchema,
  RestorePreflightResultSchema,
  RestoreRunbookSchema,
  type BackupDestination,
  type BackupDestinationSettingsInput,
  type BackupDestinationType,
  type BackupPlan,
  type BackupJob,
  type BackupOverview,
  type RestoreRunbook,
  type CreateBackupDestinationInput,
  type CreateBackupPlanInput,
  type StartBackupJobInput,
  type UpdateBackupDestinationInput,
  type UpdateBackupPlanInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import { BackupEncryptionService } from "@/modules/backups/backup-encryption.service";
import { nextScheduledRun } from "@/modules/backups/backup-schedule";

const API_TO_DB_TYPE: Record<BackupDestinationType, PrismaBackupDestinationType> = {
  local: PrismaBackupDestinationType.LOCAL,
  sftp: PrismaBackupDestinationType.SFTP,
  s3: PrismaBackupDestinationType.S3,
};

const DB_TO_API_TYPE: Record<PrismaBackupDestinationType, BackupDestinationType> = {
  LOCAL: "local",
  SFTP: "sftp",
  S3: "s3",
};

type BackupPlanRow = Prisma.BackupPlanGetPayload<{
  include: { destination: { select: { id: true; name: true; type: true; isEnabled: true; lastTestSucceeded: true } } };
}>;

/** Verwaltet Backup-Konfigurationen und die dauerhafte Jobwarteschlange. */
@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: BackupEncryptionService,
  ) {}

  async listDestinations(): Promise<BackupDestination[]> {
    const rows = await this.prisma.backupDestination.findMany({ orderBy: { name: "asc" } });
    return rows.map((row) => this.toDestination(row));
  }

  async createDestination(
    userId: string,
    input: CreateBackupDestinationInput,
  ): Promise<BackupDestination> {
    const credentials = this.credentials(input.settings);
    try {
      const row = await this.prisma.backupDestination.create({
        data: {
          name: input.name,
          type: API_TO_DB_TYPE[input.settings.type],
          config: input.settings.config as Prisma.InputJsonValue,
          encryptedCredentials: credentials
            ? this.encryption.encrypt(JSON.stringify(credentials))
            : null,
          isEnabled: input.isEnabled,
          createdById: userId,
        },
      });
      return this.toDestination(row);
    } catch (error) {
      this.rethrowUniqueName(error, "Ein Backup-Ziel mit diesem Namen existiert bereits.");
    }
  }

  async updateDestination(
    id: string,
    input: UpdateBackupDestinationInput,
  ): Promise<BackupDestination> {
    const existing = await this.prisma.backupDestination.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Backup-Ziel wurde nicht gefunden.");

    const data: Prisma.BackupDestinationUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.settings) {
      const nextType = API_TO_DB_TYPE[input.settings.type];
      const credentials = this.credentials(input.settings);
      data.type = nextType;
      data.config = input.settings.config as Prisma.InputJsonValue;
      // Jede Konfigurations- oder Zugangsdatenänderung macht den vorherigen Test ungültig.
      data.lastTestedAt = null;
      data.lastTestSucceeded = null;
      if (credentials) {
        data.encryptedCredentials = this.encryption.encrypt(JSON.stringify(credentials));
      } else if (this.requiresCredentials(input.settings.type)) {
        if (nextType !== existing.type || !existing.encryptedCredentials) {
          throw new BadRequestException(
            "Beim Wechsel auf ein Remote-Ziel müssen neue Zugangsdaten angegeben werden.",
          );
        }
      } else {
        data.encryptedCredentials = null;
      }
    }

    try {
      const row = await this.prisma.backupDestination.update({ where: { id }, data });
      return this.toDestination(row);
    } catch (error) {
      this.rethrowUniqueName(error, "Ein Backup-Ziel mit diesem Namen existiert bereits.");
    }
  }

  async deleteDestination(id: string): Promise<BackupDestination> {
    const existing = await this.prisma.backupDestination.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Backup-Ziel wurde nicht gefunden.");
    const planCount = await this.prisma.backupPlan.count({ where: { destinationId: id } });
    if (planCount > 0) {
      throw new ConflictException(
        "Das Backup-Ziel wird noch von einem Zeitplan verwendet und kann nicht gelöscht werden.",
      );
    }
    await this.prisma.backupDestination.delete({ where: { id } });
    return this.toDestination(existing);
  }

  async listPlans(): Promise<BackupPlan[]> {
    const rows = await this.prisma.backupPlan.findMany({
      include: this.planInclude(),
      orderBy: { name: "asc" },
    });
    return rows.map((row) => this.toPlan(row));
  }

  async createPlan(userId: string, input: CreateBackupPlanInput): Promise<BackupPlan> {
    const destination = await this.requireDestination(input.destinationId);
    if (input.enabled && !destination.isEnabled) {
      throw new BadRequestException("Ein aktivierter Plan benötigt ein aktiviertes Backup-Ziel.");
    }
    if (input.enabled) this.assertDestinationTested(destination);
    try {
      const row = await this.prisma.backupPlan.create({
        data: {
          name: input.name,
          enabled: input.enabled,
          destinationId: input.destinationId,
          scheduleHour: input.schedule.hour,
          scheduleMinute: input.schedule.minute,
          timezone: input.schedule.timezone,
          weekdays: input.schedule.weekdays,
          retentionDaily: input.retention.daily,
          retentionWeekly: input.retention.weekly,
          retentionMonthly: input.retention.monthly,
          nextRunAt: input.enabled ? nextScheduledRun(input.schedule, new Date()) : null,
          createdById: userId,
        },
        include: this.planInclude(),
      });
      return this.toPlan(row);
    } catch (error) {
      this.rethrowUniqueName(error, "Ein Backup-Plan mit diesem Namen existiert bereits.");
    }
  }

  async updatePlan(id: string, input: UpdateBackupPlanInput): Promise<BackupPlan> {
    const existing = await this.prisma.backupPlan.findUnique({
      where: { id },
      include: this.planInclude(),
    });
    if (!existing) throw new NotFoundException("Backup-Plan wurde nicht gefunden.");

    const destination = input.destinationId
      ? await this.requireDestination(input.destinationId)
      : existing.destination;
    const finalEnabled = input.enabled ?? existing.enabled;
    if (finalEnabled && !destination.isEnabled) {
      throw new BadRequestException("Ein aktivierter Plan benötigt ein aktiviertes Backup-Ziel.");
    }
    if (finalEnabled) this.assertDestinationTested(destination);

    const data: Prisma.BackupPlanUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.destinationId !== undefined) data.destination = { connect: { id: input.destinationId } };
    if (input.schedule) {
      data.scheduleHour = input.schedule.hour;
      data.scheduleMinute = input.schedule.minute;
      data.timezone = input.schedule.timezone;
      data.weekdays = input.schedule.weekdays;
    }
    if (input.retention) {
      data.retentionDaily = input.retention.daily;
      data.retentionWeekly = input.retention.weekly;
      data.retentionMonthly = input.retention.monthly;
    }
    const finalSchedule = input.schedule ?? {
      hour: existing.scheduleHour,
      minute: existing.scheduleMinute,
      timezone: existing.timezone,
      weekdays: existing.weekdays,
    };
    if (input.enabled !== undefined || input.schedule !== undefined) {
      data.nextRunAt = finalEnabled ? nextScheduledRun(finalSchedule, new Date()) : null;
    }

    try {
      const row = await this.prisma.backupPlan.update({
        where: { id },
        data,
        include: this.planInclude(),
      });
      return this.toPlan(row);
    } catch (error) {
      this.rethrowUniqueName(error, "Ein Backup-Plan mit diesem Namen existiert bereits.");
    }
  }

  async deletePlan(id: string): Promise<BackupPlan> {
    const existing = await this.prisma.backupPlan.findUnique({
      where: { id },
      include: this.planInclude(),
    });
    if (!existing) throw new NotFoundException("Backup-Plan wurde nicht gefunden.");
    await this.prisma.backupPlan.delete({ where: { id } });
    return this.toPlan(existing);
  }

  async listJobs(): Promise<BackupJob[]> {
    const rows = await this.prisma.backupJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => this.toJob(row));
  }

  async getJob(id: string): Promise<BackupJob> {
    const row = await this.prisma.backupJob.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Backup-Auftrag wurde nicht gefunden.");
    return this.toJob(row);
  }

  async overview(): Promise<BackupOverview> {
    const [active, successful, failed, nextPlan, enabledPlans, availableArtifacts] = await Promise.all([
      this.prisma.backupJob.findFirst({
        where: { operation: PrismaBackupJobOperation.BACKUP, status: { in: [PrismaBackupJobStatus.QUEUED, PrismaBackupJobStatus.RUNNING] } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.backupJob.findFirst({
        where: { operation: PrismaBackupJobOperation.BACKUP, status: PrismaBackupJobStatus.SUCCEEDED },
        orderBy: { finishedAt: "desc" },
      }),
      this.prisma.backupJob.findFirst({
        where: { operation: PrismaBackupJobOperation.BACKUP, status: PrismaBackupJobStatus.FAILED },
        orderBy: { finishedAt: "desc" },
      }),
      this.prisma.backupPlan.findFirst({
        where: { enabled: true, nextRunAt: { not: null } },
        orderBy: { nextRunAt: "asc" },
        select: { nextRunAt: true },
      }),
      this.prisma.backupPlan.count({ where: { enabled: true } }),
      this.prisma.backupJob.count({
        where: { status: PrismaBackupJobStatus.SUCCEEDED, artifactPath: { not: null } },
      }),
    ]);
    const latestFailureIsOpen = Boolean(
      failed?.finishedAt && (!successful?.finishedAt || failed.finishedAt > successful.finishedAt),
    );
    return {
      status: active ? "running" : latestFailureIsOpen ? "warning" : successful ? "healthy" : "never",
      activeJob: active ? this.toJob(active) : null,
      lastSuccessfulJob: successful ? this.toJob(successful) : null,
      latestFailedJob: failed ? this.toJob(failed) : null,
      nextRunAt: nextPlan?.nextRunAt?.toISOString() ?? null,
      enabledPlans,
      availableArtifacts,
    };
  }

  async startBackupJob(userId: string, input: StartBackupJobInput): Promise<BackupJob> {
    const plan = "planId" in input
      ? await this.prisma.backupPlan.findUnique({
          where: { id: input.planId },
          include: { destination: true },
        })
      : null;
    if ("planId" in input && !plan) {
      throw new NotFoundException("Backup-Plan wurde nicht gefunden.");
    }

    const destination = plan?.destination ?? await this.prisma.backupDestination.findUnique({
      where: { id: "destinationId" in input ? input.destinationId : "" },
    });
    if (!destination) throw new NotFoundException("Backup-Ziel wurde nicht gefunden.");
    if (!destination.isEnabled) {
      throw new BadRequestException("Das Backup-Ziel ist deaktiviert.");
    }
    if (
      this.requiresConnectionTest(DB_TO_API_TYPE[destination.type])
      && destination.lastTestSucceeded !== true
    ) {
      throw new BadRequestException(
        "Das externe Backup-Ziel muss vor der ersten Sicherung erfolgreich getestet werden.",
      );
    }

    const activeJob = await this.prisma.backupJob.findFirst({
      where: {
        destinationId: destination.id,
        operation: PrismaBackupJobOperation.BACKUP,
        status: { in: [PrismaBackupJobStatus.QUEUED, PrismaBackupJobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (activeJob) {
      throw new ConflictException("Für dieses Ziel läuft bereits ein Backup-Auftrag.");
    }

    const row = await this.prisma.backupJob.create({
      data: {
        operation: PrismaBackupJobOperation.BACKUP,
        trigger: PrismaBackupJobTrigger.MANUAL,
        status: PrismaBackupJobStatus.QUEUED,
        planId: plan?.id ?? null,
        destinationId: destination.id,
        requestedById: userId,
      },
    });
    return this.toJob(row);
  }

  async startConnectionTest(userId: string, destinationId: string): Promise<BackupJob> {
    const destination = await this.prisma.backupDestination.findUnique({ where: { id: destinationId } });
    if (!destination) throw new NotFoundException("Backup-Ziel wurde nicht gefunden.");
    const activeJob = await this.prisma.backupJob.findFirst({
      where: {
        destinationId,
        operation: PrismaBackupJobOperation.CONNECTION_TEST,
        status: { in: [PrismaBackupJobStatus.QUEUED, PrismaBackupJobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (activeJob) throw new ConflictException("Für dieses Ziel läuft bereits ein Verbindungstest.");
    const row = await this.prisma.backupJob.create({
      data: {
        operation: PrismaBackupJobOperation.CONNECTION_TEST,
        trigger: PrismaBackupJobTrigger.MANUAL,
        status: PrismaBackupJobStatus.QUEUED,
        destinationId,
        requestedById: userId,
      },
    });
    return this.toJob(row);
  }

  async prepareRestore(userId: string, sourceJobId: string): Promise<BackupJob> {
    const source = await this.prisma.backupJob.findUnique({
      where: { id: sourceJobId },
      include: { destination: true },
    });
    if (
      !source
      || source.operation !== PrismaBackupJobOperation.BACKUP
      || source.status !== PrismaBackupJobStatus.SUCCEEDED
      || !source.artifactPath
      || !source.destination
    ) {
      throw new BadRequestException("Das ausgewählte Backup ist nicht vollständig verfügbar.");
    }
    const activeJob = await this.prisma.backupJob.findFirst({
      where: {
        sourceJobId,
        operation: PrismaBackupJobOperation.RESTORE_PREFLIGHT,
        status: { in: [PrismaBackupJobStatus.QUEUED, PrismaBackupJobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (activeJob) throw new ConflictException("Dieses Backup wird bereits für einen Restore vorbereitet.");
    const row = await this.prisma.backupJob.create({
      data: {
        operation: PrismaBackupJobOperation.RESTORE_PREFLIGHT,
        trigger: PrismaBackupJobTrigger.MANUAL,
        status: PrismaBackupJobStatus.QUEUED,
        destinationId: source.destinationId,
        sourceJobId: source.id,
        requestedById: userId,
      },
    });
    return this.toJob(row);
  }

  async getRestoreRunbook(preflightJobId: string): Promise<RestoreRunbook> {
    const row = await this.prisma.backupJob.findUnique({ where: { id: preflightJobId } });
    if (!row || row.operation !== PrismaBackupJobOperation.RESTORE_PREFLIGHT
      || row.status !== PrismaBackupJobStatus.SUCCEEDED || !row.sourceJobId || !row.restorePreflight) {
      throw new BadRequestException("Die Restore-Vorprüfung ist noch nicht erfolgreich abgeschlossen.");
    }
    const preflight = RestorePreflightResultSchema.parse(row.restorePreflight);
    if (!preflight.ready) {
      throw new BadRequestException("Die Restore-Vorprüfung enthält noch blockierende Punkte.");
    }
    const [mountName, ...relativeSegments] = preflight.restorePath.split("/");
    if (!mountName || !/^[a-z0-9][a-z0-9_-]*$/.test(mountName)
      || relativeSegments.length === 0
      || relativeSegments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === "..")) {
      throw new BadRequestException("Der geprüfte Restore-Pfad ist ungültig.");
    }
    const relativePath = relativeSegments.join("/");
    const compose = "docker compose --env-file .env.production -f docker-compose.prod.yml";
    const restoreBase = `${compose} --profile operations run --rm backup-restore restore --mount ${mountName} --backup ${relativePath}`;
    return RestoreRunbookSchema.parse({
      sourceJobId: row.sourceJobId,
      preflightJobId: row.id,
      backupId: preflight.backupId,
      restorePath: preflight.restorePath,
      generatedAt: new Date().toISOString(),
      steps: [
        {
          key: "review",
          title: "Vorprüfung kontrollieren",
          description: "Backup-ID, Prüfsummen, Archive, Speicherplatz und benötigte Konfiguration prüfen.",
          command: null,
          danger: false,
        },
        {
          key: "dry_run",
          title: "Dry-Run ausführen",
          description: "Prüft das Backup erneut im isolierten Operations-Container, ohne Daten zu verändern.",
          command: `${restoreBase} --dry-run`,
          danger: false,
        },
        {
          key: "stop",
          title: "Schreibzugriffe stoppen",
          description: "Stoppt Reverse Proxy, Web-App, API und Backup-Worker vor der Wiederherstellung.",
          command: `${compose} stop nginx web api backup-worker`,
          danger: true,
        },
        {
          key: "restore",
          title: "Wiederherstellung bestätigen",
          description: "Ersetzt Datenbank und Uploads. Die exakte Backup-ID ist die verpflichtende Bestätigung.",
          command: `${restoreBase} --confirm ${preflight.backupId}`,
          danger: true,
        },
        {
          key: "start",
          title: "AD-Wiki starten",
          description: "Startet alle Produktionsdienste nach erfolgreichem Restore und den Migrationen.",
          command: `${compose} up -d`,
          danger: false,
        },
        {
          key: "verify",
          title: "Bereitschaft prüfen",
          description: "Prüft den Readiness-Endpunkt. Ergebnis und Dauer stehen anschließend im Audit-Log.",
          command: "curl --fail --silent --show-error --insecure https://127.0.0.1/api/v1/health/ready",
          danger: false,
        },
      ],
    });
  }

  private async requireDestination(id: string) {
    const destination = await this.prisma.backupDestination.findUnique({
      where: { id },
      select: { id: true, name: true, type: true, isEnabled: true, lastTestSucceeded: true },
    });
    if (!destination) throw new BadRequestException("Das ausgewählte Backup-Ziel existiert nicht.");
    return destination;
  }

  private credentials(settings: BackupDestinationSettingsInput): Record<string, unknown> | undefined {
    if (settings.type === "sftp" || settings.type === "s3") {
      return settings.credentials;
    }
    return undefined;
  }

  private requiresCredentials(type: BackupDestinationType): boolean {
    return type === "sftp" || type === "s3";
  }

  private requiresConnectionTest(type: BackupDestinationType): boolean {
    return type === "sftp" || type === "s3";
  }

  private assertDestinationTested(destination: {
    type: PrismaBackupDestinationType;
    lastTestSucceeded: boolean | null;
  }): void {
    if (
      this.requiresConnectionTest(DB_TO_API_TYPE[destination.type])
      && destination.lastTestSucceeded !== true
    ) {
      throw new BadRequestException(
        "Ein Plan mit externem Ziel kann erst nach einem erfolgreichen Verbindungstest aktiviert werden.",
      );
    }
  }

  private toDestination(row: PrismaBackupDestination): BackupDestination {
    const common = {
      id: row.id,
      name: row.name,
      isEnabled: row.isEnabled,
      hasCredentials: Boolean(row.encryptedCredentials),
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastTestSucceeded: row.lastTestSucceeded,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    const type = DB_TO_API_TYPE[row.type];
    switch (type) {
      case "local":
        return { ...common, type, config: MountedBackupConfigSchema.parse(row.config) };
      case "sftp":
        return { ...common, type, config: SftpBackupConfigSchema.parse(row.config) };
      case "s3":
        return { ...common, type, config: S3BackupConfigSchema.parse(row.config) };
    }
  }

  private toPlan(row: BackupPlanRow): BackupPlan {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      destination: {
        id: row.destination.id,
        name: row.destination.name,
        type: DB_TO_API_TYPE[row.destination.type],
        isEnabled: row.destination.isEnabled,
      },
      schedule: {
        hour: row.scheduleHour,
        minute: row.scheduleMinute,
        timezone: row.timezone,
        weekdays: row.weekdays,
      },
      retention: {
        daily: row.retentionDaily,
        weekly: row.retentionWeekly,
        monthly: row.retentionMonthly,
      },
      nextRunAt: row.nextRunAt?.toISOString() ?? null,
      lastRunAt: row.lastRunAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toJob(row: PrismaBackupJob): BackupJob {
    return {
      id: row.id,
      operation: row.operation.toLowerCase() as BackupJob["operation"],
      trigger: row.trigger.toLowerCase() as BackupJob["trigger"],
      status: row.status.toLowerCase() as BackupJob["status"],
      planId: row.planId,
      destinationId: row.destinationId,
      sourceJobId: row.sourceJobId,
      requestedById: row.requestedById,
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      artifactSize: row.artifactSize?.toString() ?? null,
      artifactAvailable: Boolean(row.artifactPath),
      artifactPath: row.artifactPath,
      durationMs: row.startedAt && row.finishedAt
        ? Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime())
        : null,
      checksum: row.checksum,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      restorePreflight: row.restorePreflight ? RestorePreflightResultSchema.parse(row.restorePreflight) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private planInclude() {
    return {
      destination: { select: { id: true, name: true, type: true, isEnabled: true, lastTestSucceeded: true } },
    } satisfies Prisma.BackupPlanInclude;
  }

  private rethrowUniqueName(error: unknown, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictException(message);
    }
    throw error;
  }
}
