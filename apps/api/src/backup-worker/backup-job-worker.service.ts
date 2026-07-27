import { Injectable, Logger, Optional } from "@nestjs/common";
import { BackupJobOperation, BackupJobStatus, Prisma } from "@prisma/client";
import { mkdir, rm, statfs } from "node:fs/promises";
import path from "node:path";
import {
  RestorePreflightResultSchema,
  type RestorePreflightResult,
} from "@ad-wiki/shared-types";
import {
  BackupOperationError,
  createLocalBackupArtifact,
  parseBackupMounts,
  resolveLogicalArtifactPath,
  runCommand,
  verifyBackupDirectory,
  type CreatedBackupArtifact,
} from "@/modules/backups/backup-artifact";
import { verifyNativeArchives } from "@/modules/backups/restore-cli";
import { BackupCoordinationService } from "@/modules/backups/backup-coordination.service";
import { expiredBackupJobIds } from "@/modules/backups/backup-retention";
import { BackupStorageService, type BackupStorageAdapter } from "@/modules/backups/backup-storage.service";
import { PrismaService } from "@/prisma/prisma.service";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 60_000;
const LOCK_TTL_MS = 6 * 60 * 60 * 1_000;
const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;

type WorkerJob = Prisma.BackupJobGetPayload<{
  include: { destination: true; sourceJob: true };
}>;

interface JobResult {
  artifactPath?: string;
  artifactSize?: bigint;
  checksum?: string;
  restorePreflight?: RestorePreflightResult;
}

const RESTORE_STORAGE_RESERVE_BYTES = 512n * 1024n * 1024n;

/** Verarbeitet Backup-, Verbindungstest- und Restore-Download-Aufträge außerhalb der API. */
@Injectable()
export class BackupJobWorkerService {
  private readonly logger = new Logger(BackupJobWorkerService.name);
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly coordination?: BackupCoordinationService,
    @Optional() private readonly storage?: BackupStorageService,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async runForever(): Promise<void> {
    const pollInterval = this.pollInterval();
    this.logger.log(`Backup-Worker gestartet; Abfrageintervall ${pollInterval} ms.`);
    await this.recordHeartbeat();
    const heartbeatTimer = setInterval(() => {
      void this.recordHeartbeat();
    }, WORKER_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();
    try {
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
    } finally {
      clearInterval(heartbeatTimer);
    }
    this.logger.log("Backup-Worker wurde beendet.");
  }

  private async recordHeartbeat(): Promise<void> {
    if (!this.coordination) return;
    try {
      await this.coordination.recordWorkerHeartbeat();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Backup-Worker-Heartbeat konnte nicht geschrieben werden: ${message}`);
    }
  }

  async processNextJob(): Promise<boolean> {
    const candidate = await this.prisma.backupJob.findFirst({
      where: {
        status: BackupJobStatus.QUEUED,
        operation: {
          in: [
            BackupJobOperation.BACKUP,
            BackupJobOperation.CONNECTION_TEST,
            BackupJobOperation.RESTORE_PREFLIGHT,
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      include: { destination: true, sourceJob: true },
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
        const result = await this.execute(candidate);
        await this.markSucceeded(candidate, result);
        if (candidate.operation === BackupJobOperation.BACKUP) await this.applyRetention(candidate.planId);
        this.logger.log(`Backup-Auftrag ${candidate.id} (${candidate.operation}) wurde erfolgreich abgeschlossen.`);
      } catch (error) {
        await this.markFailed(candidate, error);
      }
    } finally {
      if (this.coordination && jobLock) {
        await this.coordination.releaseLock(`job:${candidate.id}`, jobLock);
      }
    }
    return true;
  }

  private async execute(candidate: WorkerJob): Promise<JobResult> {
    switch (candidate.operation) {
      case BackupJobOperation.BACKUP:
        return this.executeBackup(candidate);
      case BackupJobOperation.CONNECTION_TEST:
        return this.executeConnectionTest(candidate);
      case BackupJobOperation.RESTORE_PREFLIGHT:
        return this.executeRestorePreflight(candidate);
      default:
        throw new BackupOperationError("BACKUP_OPERATION_UNSUPPORTED", "Dieser Backup-Auftrag wird nicht unterstützt.");
    }
  }

  private async executeBackup(candidate: WorkerJob): Promise<JobResult> {
    const adapter = this.adapter(candidate);
    const uploadsDirectory = process.env.BACKUP_UPLOADS_DIR?.trim();
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!uploadsDirectory) throw new BackupOperationError("UPLOADS_PATH_MISSING", "BACKUP_UPLOADS_DIR ist nicht gesetzt.");
    if (!databaseUrl) throw new BackupOperationError("DATABASE_URL_MISSING", "DATABASE_URL ist nicht gesetzt.");

    const stagingDirectory = path.join(this.requireStorage().stagingRoot(), `job-${candidate.id}`);
    await mkdir(this.requireStorage().stagingRoot(), { recursive: true });
    await mkdir(stagingDirectory, { recursive: false });
    try {
      const artifact = await this.createConsistentArtifact({
        backupId: candidate.id,
        destinationDirectory: stagingDirectory,
        uploadsDirectory,
        databaseUrl,
      });
      return {
        artifactPath: await adapter.publish(artifact),
        artifactSize: artifact.size,
        checksum: artifact.checksum,
      };
    } finally {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
  }

  private async executeConnectionTest(candidate: WorkerJob): Promise<JobResult> {
    const adapter = this.adapter(candidate, true);
    await adapter.testConnection();
    if (!candidate.destinationId) {
      throw new BackupOperationError("BACKUP_DESTINATION_MISSING", "Das Backup-Ziel existiert nicht mehr.");
    }
    await this.prisma.backupDestination.update({
      where: { id: candidate.destinationId },
      data: { lastTestedAt: new Date(), lastTestSucceeded: true },
    });
    return {};
  }

  private async executeRestorePreflight(candidate: WorkerJob): Promise<JobResult> {
    const source = candidate.sourceJob;
    if (!source || source.status !== BackupJobStatus.SUCCEEDED || !source.artifactPath
      || source.destinationId !== candidate.destinationId) {
      throw new BackupOperationError(
        "BACKUP_RESTORE_SOURCE_INVALID",
        "Das ausgewählte Backup ist nicht vollständig oder nicht mehr verfügbar.",
      );
    }

    const sourceAdapter = this.adapter(candidate, true);
    const verifiedManifest = await sourceAdapter.verify(source.artifactPath, this.requireStorage().stagingRoot());
    const restoreTarget = this.requireStorage().restoreTarget();
    let restorePath = source.artifactPath;
    let backupDirectory: string;

    if (sourceAdapter.isRemote) {
      await mkdir(restoreTarget.root, { recursive: true });
      const artifactName = path.posix.basename(source.artifactPath);
      if (!/^ad-wiki-[A-Za-z0-9-]+$/.test(artifactName)) {
        throw new BackupOperationError("BACKUP_PATH_INVALID", "Der gespeicherte Artefaktname ist ungültig.");
      }
      const existingDirectory = path.join(restoreTarget.root, artifactName);
      const existingManifest = await verifyBackupDirectory(existingDirectory).catch(() => null);
      if (existingManifest?.backupId === source.id) {
        restorePath = restoreTarget.adapter.referenceFor(artifactName);
        backupDirectory = existingDirectory;
      } else {
        await rm(existingDirectory, { recursive: true, force: true });
        const downloaded = await sourceAdapter.download(source.artifactPath, restoreTarget.root);
        restorePath = restoreTarget.adapter.referenceFor(downloaded.reference);
        backupDirectory = downloaded.directory;
      }
    } else {
      backupDirectory = resolveLogicalArtifactPath(
        source.artifactPath,
        parseBackupMounts(process.env.BACKUP_MOUNTS_JSON),
      );
    }

    const manifest = await verifyBackupDirectory(backupDirectory);
    if (manifest.backupId !== source.id || verifiedManifest.backupId !== manifest.backupId) {
      throw new BackupOperationError("BACKUP_MANIFEST_MISMATCH", "Backup-ID und Manifest stimmen nicht überein.");
    }

    const databaseUrl = process.env.DATABASE_URL?.trim();
    const uploadsDirectory = process.env.BACKUP_UPLOADS_DIR?.trim();
    if (!databaseUrl) throw new BackupOperationError("DATABASE_URL_MISSING", "DATABASE_URL ist nicht gesetzt.");
    if (!uploadsDirectory) throw new BackupOperationError("UPLOADS_PATH_MISSING", "BACKUP_UPLOADS_DIR ist nicht gesetzt.");
    await verifyNativeArchives(backupDirectory, databaseUrl, runCommand);

    const requiredBytes = (source.artifactSize ?? 0n) * 2n + RESTORE_STORAGE_RESERVE_BYTES;
    const uploadsSpace = await statfs(uploadsDirectory, { bigint: true });
    const uploadsAvailable = uploadsSpace.bavail * uploadsSpace.bsize;
    let availableBytes = uploadsAvailable;
    if (sourceAdapter.isRemote) {
      const restoreSpace = await statfs(restoreTarget.root, { bigint: true });
      const restoreAvailable = restoreSpace.bavail * restoreSpace.bsize;
      availableBytes = restoreAvailable < uploadsAvailable ? restoreAvailable : uploadsAvailable;
    }
    const secrets = [
      { key: "database" as const, required: true, configured: true },
      { key: "uploads" as const, required: true, configured: true },
      { key: "restore_mount" as const, required: true, configured: true },
      {
        key: "source_credentials" as const,
        required: sourceAdapter.isRemote,
        configured: !sourceAdapter.isRemote || Boolean(candidate.destination?.encryptedCredentials),
      },
    ];
    const storageSufficient = availableBytes >= requiredBytes;
    const restorePreflight = RestorePreflightResultSchema.parse({
      backupId: manifest.backupId,
      formatVersion: manifest.formatVersion,
      backupCreatedAt: manifest.createdAt,
      restorePath,
      integrityVerified: true,
      databaseArchiveReadable: true,
      uploadsArchiveReadable: true,
      compatibility: "compatible",
      secrets,
      storage: {
        requiredBytes: requiredBytes.toString(),
        availableBytes: availableBytes.toString(),
        sufficient: storageSufficient,
      },
      ready: storageSufficient && secrets.every((secret) => !secret.required || secret.configured),
      checkedAt: new Date().toISOString(),
    });
    return {
      artifactPath: restorePath,
      artifactSize: source.artifactSize ?? undefined,
      checksum: source.checksum ?? undefined,
      restorePreflight,
    };
  }

  private adapter(candidate: WorkerJob, allowDisabled = false): BackupStorageAdapter {
    if (!candidate.destination) {
      throw new BackupOperationError("BACKUP_DESTINATION_MISSING", "Das Backup-Ziel existiert nicht mehr.");
    }
    if (!allowDisabled && !candidate.destination.isEnabled) {
      throw new BackupOperationError("BACKUP_DESTINATION_DISABLED", "Das Backup-Ziel ist deaktiviert.");
    }
    return this.requireStorage().adapter(candidate.destination);
  }

  private requireStorage(): BackupStorageService {
    if (!this.storage) {
      throw new BackupOperationError(
        "BACKUP_DESTINATION_UNSUPPORTED",
        "Der Storage-Adapter ist im Backup-Worker nicht verfügbar.",
      );
    }
    return this.storage;
  }

  private async markSucceeded(candidate: WorkerJob, result: JobResult): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.backupJob.update({
        where: { id: candidate.id },
        data: {
          status: BackupJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          artifactPath: result.artifactPath,
          artifactSize: result.artifactSize,
          checksum: result.checksum,
          restorePreflight: result.restorePreflight as Prisma.InputJsonValue | undefined,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          userId: candidate.requestedById,
          action: "backup_job.succeeded",
          resource: "backup_job",
          resourceId: candidate.id,
          details: {
            operation: candidate.operation.toLowerCase(),
            destinationId: candidate.destinationId,
            sourceJobId: candidate.sourceJobId,
            ...(result.artifactSize !== undefined ? { artifactSize: result.artifactSize.toString() } : {}),
            ...(result.checksum ? { checksum: result.checksum } : {}),
            ...(result.restorePreflight ? {
              restoreReady: result.restorePreflight.ready,
              storageSufficient: result.restorePreflight.storage.sufficient,
            } : {}),
          } satisfies Prisma.InputJsonObject,
        },
      }),
    ]);
  }

  private async markFailed(candidate: WorkerJob, error: unknown): Promise<void> {
    const failure = this.safeFailure(error);
    const operations: Prisma.PrismaPromise<unknown>[] = [
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
            operation: candidate.operation.toLowerCase(),
            destinationId: candidate.destinationId,
            sourceJobId: candidate.sourceJobId,
            errorCode: failure.code,
          } satisfies Prisma.InputJsonObject,
        },
      }),
    ];
    if (candidate.operation === BackupJobOperation.CONNECTION_TEST && candidate.destinationId) {
      operations.push(this.prisma.backupDestination.update({
        where: { id: candidate.destinationId },
        data: { lastTestedAt: new Date(), lastTestSucceeded: false },
      }));
    }
    await this.prisma.$transaction(operations);
    this.logger.error(`Backup-Auftrag ${candidate.id} fehlgeschlagen (${failure.code}).`);
  }

  private async createConsistentArtifact(input: {
    backupId: string;
    destinationDirectory: string;
    uploadsDirectory: string;
    databaseUrl: string;
  }): Promise<CreatedBackupArtifact> {
    const barrier = this.coordination ? await this.coordination.acquireWriteBarrier(LOCK_TTL_MS) : null;
    if (this.coordination && !barrier) {
      throw new BackupOperationError("BACKUP_WRITE_BARRIER_BUSY", "Ein anderer Backup-Snapshot läuft bereits.");
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

  private async applyRetention(planId: string | null): Promise<void> {
    if (!planId || !this.storage) return;
    try {
      const plan = await this.prisma.backupPlan.findUnique({
        where: { id: planId },
        select: { timezone: true, retentionDaily: true, retentionWeekly: true, retentionMonthly: true },
      });
      if (!plan) return;
      const jobs = await this.prisma.backupJob.findMany({
        where: {
          planId,
          operation: BackupJobOperation.BACKUP,
          status: BackupJobStatus.SUCCEEDED,
          artifactPath: { not: null },
        },
        select: { id: true, createdAt: true, artifactPath: true, destination: true },
        orderBy: { createdAt: "desc" },
      });
      const expired = new Set(expiredBackupJobIds(jobs, {
        daily: plan.retentionDaily,
        weekly: plan.retentionWeekly,
        monthly: plan.retentionMonthly,
      }, plan.timezone));

      for (const job of jobs) {
        if (!expired.has(job.id) || !job.artifactPath || !job.destination) continue;
        const adapter = this.storage.adapter(job.destination);
        const manifest = await adapter.verify(job.artifactPath, this.storage.stagingRoot());
        if (manifest.backupId !== job.id) {
          throw new BackupOperationError("BACKUP_MANIFEST_MISMATCH", "Backup-ID und Manifest stimmen nicht überein.");
        }
        await adapter.delete(job.artifactPath);
        await this.prisma.$transaction([
          this.prisma.backupJob.update({ where: { id: job.id }, data: { artifactPath: null } }),
          this.prisma.auditLog.create({
            data: {
              action: "backup_retention.deleted",
              resource: "backup_job",
              resourceId: job.id,
              details: { planId, destinationId: job.destination.id } satisfies Prisma.InputJsonObject,
            },
          }),
        ]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Aufbewahrungsregeln für Plan ${planId} konnten nicht vollständig angewendet werden: ${message}`);
    }
  }

  private safeFailure(error: unknown): { code: string; message: string } {
    if (error instanceof BackupOperationError) {
      return { code: error.code.slice(0, 100), message: error.message.slice(0, 1000) };
    }
    return {
      code: "BACKUP_UNEXPECTED_ERROR",
      message: "Beim Verarbeiten des Backup-Auftrags ist ein unerwarteter Fehler aufgetreten.",
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
