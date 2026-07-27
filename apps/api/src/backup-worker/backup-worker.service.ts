import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  BackupDestinationType,
  BackupJobOperation,
  BackupJobStatus,
  Prisma,
} from "@prisma/client";
import { MountedBackupConfigSchema } from "@ad-wiki/shared-types";
import {
  BackupOperationError,
  createLocalBackupArtifact,
  parseBackupMounts,
  resolveLogicalArtifactPath,
  resolveMountedDestination,
  verifyBackupDirectory,
  type CreatedBackupArtifact,
} from "@/modules/backups/backup-artifact";
import { rm } from "node:fs/promises";
import { BackupCoordinationService } from "@/modules/backups/backup-coordination.service";
import { expiredBackupJobIds } from "@/modules/backups/backup-retention";
import { PrismaService } from "@/prisma/prisma.service";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 60_000;
const LOCK_TTL_MS = 6 * 60 * 60 * 1_000;

/** Verarbeitet atomar übernommene Backup-Aufträge außerhalb des API-Prozesses. */
@Injectable()
export class BackupWorkerService {
  private readonly logger = new Logger(BackupWorkerService.name);
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly coordination?: BackupCoordinationService,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async runForever(): Promise<void> {
    const pollInterval = this.pollInterval();
    this.logger.log(`Backup-Worker gestartet; Abfrageintervall ${pollInterval} ms.`);
    while (!this.stopping) {
      let processed = false;
      try {
        processed = await this.processNextJob();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Backup-Warteschlange konnte nicht abgefragt werden: ${message}`);
      }
      if (!processed && !this.stopping) await this.delay(pollInterval);
    }
    this.logger.log("Backup-Worker wurde beendet.");
  }

  async processNextJob(): Promise<boolean> {
    const candidate = await this.prisma.backupJob.findFirst({
      where: { status: BackupJobStatus.QUEUED, operation: BackupJobOperation.BACKUP },
      orderBy: { createdAt: "asc" },
      include: { destination: true },
    });
    if (!candidate) return false;

    const jobLock = this.coordination
      ? await this.coordination.acquireLock(`job:${candidate.id}`, LOCK_TTL_MS)
      : null;
    if (this.coordination && !jobLock) return true;

    const claimed = await this.prisma.backupJob.updateMany({
      where: { id: candidate.id, status: BackupJobStatus.QUEUED },
      data: { status: BackupJobStatus.RUNNING, startedAt: new Date(), errorCode: null, errorMessage: null },
    });
    if (claimed.count !== 1) {
      if (this.coordination && jobLock) {
        await this.coordination.releaseLock(`job:${candidate.id}`, jobLock);
      }
      return true;
    }

    try {
      try {
        if (!candidate.destination) {
        throw new BackupOperationError("BACKUP_DESTINATION_MISSING", "Das Backup-Ziel existiert nicht mehr.");
      }
      if (!candidate.destination.isEnabled) {
        throw new BackupOperationError("BACKUP_DESTINATION_DISABLED", "Das Backup-Ziel ist deaktiviert.");
      }
      if (candidate.destination.type !== BackupDestinationType.LOCAL) {
        throw new BackupOperationError(
          "BACKUP_DESTINATION_UNSUPPORTED",
          "Dieser Worker unterstützt derzeit ausschließlich lokale Backup-Ziele.",
        );
      }

      const config = MountedBackupConfigSchema.parse(candidate.destination.config);
      const mounts = parseBackupMounts(process.env.BACKUP_MOUNTS_JSON);
      const destinationDirectory = resolveMountedDestination(config, mounts);
      const uploadsDirectory = process.env.BACKUP_UPLOADS_DIR?.trim();
      const databaseUrl = process.env.DATABASE_URL?.trim();
      if (!uploadsDirectory) {
        throw new BackupOperationError("UPLOADS_PATH_MISSING", "BACKUP_UPLOADS_DIR ist nicht gesetzt.");
      }
      if (!databaseUrl) {
        throw new BackupOperationError("DATABASE_URL_MISSING", "DATABASE_URL ist nicht gesetzt.");
      }

      const artifact = await this.createConsistentArtifact({
        backupId: candidate.id,
        destinationDirectory,
        uploadsDirectory,
        databaseUrl,
      });
      const logicalPath = [config.mountName, config.subdirectory, artifact.relativeDirectory]
        .filter(Boolean)
        .join("/");
      await this.prisma.$transaction([
        this.prisma.backupJob.update({
          where: { id: candidate.id },
          data: {
            status: BackupJobStatus.SUCCEEDED,
            finishedAt: new Date(),
            artifactPath: logicalPath,
            artifactSize: artifact.size,
            checksum: artifact.checksum,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            userId: candidate.requestedById,
            action: "backup_job.succeeded",
            resource: "backup_job",
            resourceId: candidate.id,
            details: {
              destinationId: candidate.destination.id,
              artifactSize: artifact.size.toString(),
              checksum: artifact.checksum,
            } satisfies Prisma.InputJsonObject,
          },
        }),
      ]);
      await this.applyRetention(candidate.planId, mounts);
      this.logger.log(`Backup-Auftrag ${candidate.id} wurde erfolgreich abgeschlossen.`);
      } catch (error) {
        const failure = this.safeFailure(error);
        await this.prisma.$transaction([
        this.prisma.backupJob.update({
          where: { id: candidate.id },
          data: {
            status: BackupJobStatus.FAILED,
            finishedAt: new Date(),
            errorCode: failure.code,
            errorMessage: failure.message,
          },
        }),
        this.prisma.auditLog.create({
          data: {
            userId: candidate.requestedById,
            action: "backup_job.failed",
            resource: "backup_job",
            resourceId: candidate.id,
            details: {
              destinationId: candidate.destinationId,
              errorCode: failure.code,
            } satisfies Prisma.InputJsonObject,
          },
        }),
        ]);
        this.logger.error(`Backup-Auftrag ${candidate.id} fehlgeschlagen (${failure.code}).`);
      }
    } finally {
      if (this.coordination && jobLock) {
        await this.coordination.releaseLock(`job:${candidate.id}`, jobLock);
      }
    }
    return true;
  }

  private async createConsistentArtifact(input: {
    backupId: string;
    destinationDirectory: string;
    uploadsDirectory: string;
    databaseUrl: string;
  }): Promise<CreatedBackupArtifact> {
    const barrier = this.coordination
      ? await this.coordination.acquireWriteBarrier(LOCK_TTL_MS)
      : null;
    if (this.coordination && !barrier) {
      throw new BackupOperationError("BACKUP_WRITE_BARRIER_BUSY", "Ein anderer Backup-Snapshot laeuft bereits.");
    }
    try {
      if (this.coordination) {
        try {
          await this.coordination.waitForWritesToDrain(30_000);
        } catch (error) {
          throw new BackupOperationError(
            "BACKUP_WRITES_DID_NOT_DRAIN",
            "Aktive Schreibzugriffe konnten nicht rechtzeitig abgeschlossen werden.",
            { cause: error },
          );
        }
      }
      return await createLocalBackupArtifact(input);
    } finally {
      if (this.coordination && barrier) await this.coordination.releaseWriteBarrier(barrier);
    }
  }

  private async applyRetention(planId: string | null, mounts: ReadonlyMap<string, string>): Promise<void> {
    if (!planId) return;
    try {
      const plan = await this.prisma.backupPlan.findUnique({
        where: { id: planId },
        select: {
          timezone: true,
          retentionDaily: true,
          retentionWeekly: true,
          retentionMonthly: true,
        },
      });
      if (!plan) return;
      const jobs = await this.prisma.backupJob.findMany({
        where: {
          planId,
          operation: BackupJobOperation.BACKUP,
          status: BackupJobStatus.SUCCEEDED,
          artifactPath: { not: null },
        },
        select: { id: true, createdAt: true, artifactPath: true },
        orderBy: { createdAt: "desc" },
      });
      const expired = new Set(expiredBackupJobIds(jobs, {
        daily: plan.retentionDaily,
        weekly: plan.retentionWeekly,
        monthly: plan.retentionMonthly,
      }, plan.timezone));

      for (const job of jobs) {
        if (!expired.has(job.id) || !job.artifactPath) continue;
        const directory = resolveLogicalArtifactPath(job.artifactPath, mounts);
        const manifest = await verifyBackupDirectory(directory);
        if (manifest.backupId !== job.id) {
          throw new BackupOperationError(
            "BACKUP_MANIFEST_MISMATCH",
            "Backup-ID und Manifest stimmen nicht ueberein.",
          );
        }
        await rm(directory, { recursive: true, force: false });
        await this.prisma.$transaction([
          this.prisma.backupJob.update({ where: { id: job.id }, data: { artifactPath: null } }),
          this.prisma.auditLog.create({
            data: {
              action: "backup_retention.deleted",
              resource: "backup_job",
              resourceId: job.id,
              details: { planId } satisfies Prisma.InputJsonObject,
            },
          }),
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Aufbewahrungsregeln fuer Plan ${planId} konnten nicht vollstaendig angewendet werden: ${message}`);
    }
  }

  private safeFailure(error: unknown): { code: string; message: string } {
    if (error instanceof BackupOperationError) {
      return { code: error.code.slice(0, 100), message: error.message.slice(0, 1000) };
    }
    return {
      code: "BACKUP_UNEXPECTED_ERROR",
      message: "Beim Erstellen des Backups ist ein unerwarteter Fehler aufgetreten.",
    };
  }

  private pollInterval(): number {
    const value = Number(process.env.BACKUP_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
    return Number.isSafeInteger(value) && value >= MIN_POLL_INTERVAL_MS && value <= MAX_POLL_INTERVAL_MS
      ? value
      : DEFAULT_POLL_INTERVAL_MS;
  }

  private async delay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
