import assert from "node:assert/strict";
import test from "node:test";
import { BackupDestinationType, BackupJobOperation, BackupJobStatus, BackupJobTrigger } from "@prisma/client";
import { RestorePreflightResultSchema, RestoreRunbookSchema } from "@ad-wiki/shared-types";
import { BackupsService } from "../../dist/modules/backups/backups.service.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "20000000-0000-4000-8000-000000000002";
const SOURCE_JOB_ID = "30000000-0000-4000-8000-000000000003";
const PREFLIGHT_JOB_ID = "40000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-07-22T18:00:00.000Z");

const PREFLIGHT = RestorePreflightResultSchema.parse({
  backupId: SOURCE_JOB_ID,
  formatVersion: 1,
  backupCreatedAt: NOW.toISOString(),
  restorePath: "local/restore/ad-wiki-20260722T180000Z-30000000-0000-4000-8000-000000000003",
  integrityVerified: true,
  databaseArchiveReadable: true,
  uploadsArchiveReadable: true,
  compatibility: "compatible",
  secrets: [
    { key: "database", required: true, configured: true },
    { key: "uploads", required: true, configured: true },
    { key: "restore_mount", required: true, configured: true },
    { key: "source_credentials", required: false, configured: true },
  ],
  storage: { requiredBytes: "536870912", availableBytes: "1073741824", sufficient: true },
  ready: true,
  checkedAt: NOW.toISOString(),
});

test("Restore-Vorprüfung speichert nur redigierte Zustände und keine Geheimnisse", () => {
  const serialized = JSON.stringify(PREFLIGHT);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("privateKey"), false);
  assert.equal(serialized.includes("secretAccessKey"), false);
  assert.equal(PREFLIGHT.ready, true);
});

test("auch lokale Backups werden als eigener Restore-Vorprüfungsauftrag eingereiht", async () => {
  let created: Record<string, unknown> | undefined;
  const destination = {
    id: DESTINATION_ID,
    name: "Lokal",
    type: BackupDestinationType.LOCAL,
    config: { mountName: "local", subdirectory: "" },
    encryptedCredentials: null,
    isEnabled: true,
    lastTestedAt: null,
    lastTestSucceeded: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdById: USER_ID,
  };
  const service = new BackupsService({
    backupJob: {
      findUnique: async () => ({
        ...jobRow(SOURCE_JOB_ID, BackupJobOperation.BACKUP, BackupJobStatus.SUCCEEDED),
        artifactPath: "local/ad-wiki-20260722T180000Z-30000000-0000-4000-8000-000000000003",
        destination,
      }),
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data;
        return jobRow(PREFLIGHT_JOB_ID, BackupJobOperation.RESTORE_PREFLIGHT, BackupJobStatus.QUEUED);
      },
    },
  } as unknown as ConstructorParameters<typeof BackupsService>[0], {} as ConstructorParameters<typeof BackupsService>[1]);

  const job = await service.prepareRestore(USER_ID, SOURCE_JOB_ID);
  assert.equal(job.operation, "restore_preflight");
  assert.equal(created?.sourceJobId, SOURCE_JOB_ID);
});

test("Runbook enthält feste Dry-Run-, Stopp-, Restore- und Health-Schritte", async () => {
  const service = new BackupsService({
    backupJob: {
      findUnique: async () => ({
        ...jobRow(PREFLIGHT_JOB_ID, BackupJobOperation.RESTORE_PREFLIGHT, BackupJobStatus.SUCCEEDED),
        sourceJobId: SOURCE_JOB_ID,
        restorePreflight: PREFLIGHT,
      }),
    },
  } as unknown as ConstructorParameters<typeof BackupsService>[0], {} as ConstructorParameters<typeof BackupsService>[1]);

  const runbook = RestoreRunbookSchema.parse(await service.getRestoreRunbook(PREFLIGHT_JOB_ID));
  assert.deepEqual(runbook.steps.map((step) => step.key), ["review", "dry_run", "stop", "restore", "start", "verify"]);
  assert.match(runbook.steps[1].command ?? "", /--dry-run$/);
  assert.match(runbook.steps[2].command ?? "", /stop nginx web api backup-worker$/);
  assert.match(runbook.steps[3].command ?? "", new RegExp(`--confirm ${SOURCE_JOB_ID}$`));
  assert.equal(runbook.steps[3].danger, true);
  assert.equal(JSON.stringify(runbook).includes("secret"), false);
});

test("Runbook übernimmt keine Shell-Steuerzeichen aus gespeicherten Pfaden", async () => {
  const service = new BackupsService({
    backupJob: {
      findUnique: async () => ({
        ...jobRow(PREFLIGHT_JOB_ID, BackupJobOperation.RESTORE_PREFLIGHT, BackupJobStatus.SUCCEEDED),
        sourceJobId: SOURCE_JOB_ID,
        restorePreflight: { ...PREFLIGHT, restorePath: "local/restore;docker-run/ad-wiki-20260722" },
      }),
    },
  } as unknown as ConstructorParameters<typeof BackupsService>[0], {} as ConstructorParameters<typeof BackupsService>[1]);
  await assert.rejects(() => service.getRestoreRunbook(PREFLIGHT_JOB_ID), /Restore-Pfad ist ungültig/);
});

function jobRow(id: string, operation: BackupJobOperation, status: BackupJobStatus) {
  return {
    id,
    operation,
    trigger: BackupJobTrigger.MANUAL,
    status,
    scheduledFor: null,
    startedAt: null,
    finishedAt: null,
    artifactPath: null,
    artifactSize: null,
    checksum: null,
    errorCode: null,
    errorMessage: null,
    restorePreflight: null,
    createdAt: NOW,
    planId: null,
    destinationId: DESTINATION_ID,
    sourceJobId: null,
    requestedById: USER_ID,
  };
}
