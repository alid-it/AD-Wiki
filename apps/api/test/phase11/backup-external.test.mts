import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BackupDestinationType,
  BackupJobOperation,
  BackupJobStatus,
  BackupJobTrigger,
} from "@prisma/client";
import {
  BackupDestinationSchema,
  CreateBackupDestinationSchema,
  S3BackupConfigSchema,
  SftpBackupConfigSchema,
  UpdateBackupDestinationSchema,
} from "@ad-wiki/shared-types";
import {
  createLocalBackupArtifact,
  verifyBackupDirectory,
  type CommandRunner,
} from "../../dist/modules/backups/backup-artifact.js";
import { BackupStorageService } from "../../dist/modules/backups/backup-storage.service.js";
import { BackupsService } from "../../dist/modules/backups/backups.service.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "20000000-0000-4000-8000-000000000002";
const SOURCE_JOB_ID = "30000000-0000-4000-8000-000000000003";
const QUEUED_JOB_ID = "40000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-07-22T12:00:00.000Z");

test("Remote-Ziele erzwingen Host-Key-, TLS- und Verschluesselungsregeln", () => {
  assert.equal(SftpBackupConfigSchema.safeParse({
    host: "backup.example.org",
    port: 22,
    username: "backup",
    basePath: "/ad-wiki",
    hostKeyFingerprint: "unsicher",
  }).success, false);
  assert.equal(S3BackupConfigSchema.safeParse({
    endpoint: "http://minio.example.org",
    region: "eu-central-1",
    bucket: "ad-wiki-backups",
  }).success, false);
  assert.equal(S3BackupConfigSchema.safeParse({
    endpoint: "https://secret@minio.example.org?token=leak",
    region: "eu-central-1",
    bucket: "ad-wiki-backups",
  }).success, false);
  assert.equal(S3BackupConfigSchema.safeParse({
    endpoint: "https://minio.example.org",
    region: "eu-central-1",
    bucket: "ad-wiki-backups",
    serverSideEncryption: "aws:kms",
  }).success, false);
  assert.equal(CreateBackupDestinationSchema.safeParse({
    name: "SFTP",
    isEnabled: true,
    settings: {
      type: "sftp",
      config: {
        host: "backup.example.org",
        port: 22,
        username: "backup",
        basePath: "/ad-wiki",
        hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
      },
    },
  }).success, false);
});

test("API-Antwort eines Remote-Ziels enthaelt niemals Zugangsdaten", () => {
  const parsed = BackupDestinationSchema.parse({
    id: DESTINATION_ID,
    name: "SFTP",
    type: "sftp",
    isEnabled: true,
    hasCredentials: true,
    lastTestedAt: null,
    lastTestSucceeded: null,
    config: {
      host: "backup.example.org",
      port: 22,
      username: "backup",
      basePath: "/ad-wiki",
      hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
    },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  assert.equal("credentials" in parsed, false);
  assert.equal(JSON.stringify(parsed).includes("privateKey"), false);
});

test("Mount-Adapter prueft Verbindung, Upload, Download, Pruefsumme und Loeschung", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ad-wiki-storage-test-"));
  const artifactRoot = path.join(root, "artifact");
  const destinationRoot = path.join(root, "destination");
  const downloadRoot = path.join(root, "download");
  const uploads = path.join(root, "uploads");
  const previousMounts = process.env.BACKUP_MOUNTS_JSON;
  process.env.BACKUP_MOUNTS_JSON = JSON.stringify({ network: destinationRoot });
  try {
    await mkdir(uploads, { recursive: true });
    await writeFile(path.join(uploads, "logo.png"), "upload", "utf8");
    const execute: CommandRunner = async (command, args) => {
      const output = args.find((argument) => argument.startsWith("--file="))?.slice("--file=".length);
      if (!output) throw new Error(`Ausgabepfad fuer ${command} fehlt.`);
      await writeFile(output, command === "pg_dump" ? "database" : "uploads", "utf8");
      return { stdout: "", stderr: "" };
    };
    const artifact = await createLocalBackupArtifact({
      backupId: SOURCE_JOB_ID,
      destinationDirectory: artifactRoot,
      uploadsDirectory: uploads,
      databaseUrl: "postgresql://adwiki:secret@postgres:5432/adwiki_wiki",
      now: NOW,
    }, execute);
    const storage = new BackupStorageService({} as ConstructorParameters<typeof BackupStorageService>[0]);
    const adapter = storage.adapter(destinationRow(BackupDestinationType.LOCAL));
    await adapter.testConnection();
    const reference = await adapter.publish(artifact);
    assert.equal((await adapter.verify(reference, path.join(root, "verify"))).backupId, SOURCE_JOB_ID);
    const downloaded = await adapter.download(reference, downloadRoot);
    assert.equal((await verifyBackupDirectory(downloaded.directory)).backupId, SOURCE_JOB_ID);
    await adapter.delete(reference);
    await assert.rejects(() => adapter.verify(reference, path.join(root, "verify-2")));
  } finally {
    if (previousMounts === undefined) delete process.env.BACKUP_MOUNTS_JSON;
    else process.env.BACKUP_MOUNTS_JSON = previousMounts;
    await rm(root, { recursive: true, force: true });
  }
});

test("API reiht Verbindungstest und Restore-Vorbereitung als eigene Jobs ein", async () => {
  const creates: Record<string, unknown>[] = [];
  const source = {
    ...jobRow(SOURCE_JOB_ID, BackupJobOperation.BACKUP, BackupJobStatus.SUCCEEDED),
    artifactPath: "ad-wiki-20260722-120000-30000000",
    destination: destinationRow(BackupDestinationType.S3),
  };
  const prisma = {
    backupDestination: { findUnique: async () => destinationRow(BackupDestinationType.S3) },
    backupJob: {
      findUnique: async () => source,
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        return jobRow(QUEUED_JOB_ID, data.operation as BackupJobOperation, BackupJobStatus.QUEUED, data.sourceJobId as string | undefined);
      },
    },
  };
  const service = new BackupsService(
    prisma as unknown as ConstructorParameters<typeof BackupsService>[0],
    {} as ConstructorParameters<typeof BackupsService>[1],
  );
  assert.equal((await service.startConnectionTest(USER_ID, DESTINATION_ID)).operation, "connection_test");
  assert.equal((await service.prepareRestore(USER_ID, SOURCE_JOB_ID)).operation, "restore_preflight");
  assert.equal(creates[1]?.sourceJobId, SOURCE_JOB_ID);
  assert.equal(creates[1]?.destinationId, DESTINATION_ID);
});

test("Konfigurationsaenderungen machen einen alten Verbindungstest ungueltig", async () => {
  const existing = destinationRow(BackupDestinationType.S3);
  let updateData: Record<string, unknown> | undefined;
  const service = new BackupsService({
    backupDestination: {
      findUnique: async () => existing,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateData = data;
        return { ...existing, config: data.config, lastTestedAt: null, lastTestSucceeded: null };
      },
    },
  } as unknown as ConstructorParameters<typeof BackupsService>[0], {
    encrypt: (value: string) => `encrypted:${value.length}`,
  } as ConstructorParameters<typeof BackupsService>[1]);
  await service.updateDestination(DESTINATION_ID, UpdateBackupDestinationSchema.parse({
    settings: {
      type: "s3",
      config: {
        endpoint: "https://new-s3.example.org",
        region: "eu-central-1",
        bucket: "ad-wiki-backups",
        prefix: "",
        forcePathStyle: false,
        serverSideEncryption: "AES256",
      },
      credentials: { accessKeyId: "access", secretAccessKey: "secret" },
    },
  }));
  assert.equal(updateData?.lastTestedAt, null);
  assert.equal(updateData?.lastTestSucceeded, null);
});

function destinationRow(type: BackupDestinationType) {
  return {
    id: DESTINATION_ID,
    name: "Extern",
    type,
    config: type === BackupDestinationType.LOCAL
      ? { mountName: "network", subdirectory: "" }
      : { endpoint: "https://s3.example.org", region: "eu-central-1", bucket: "ad-wiki-backups", prefix: "", forcePathStyle: false, serverSideEncryption: "AES256" },
    encryptedCredentials: type === BackupDestinationType.LOCAL ? null : "verschluesselt",
    isEnabled: true,
    lastTestedAt: NOW,
    lastTestSucceeded: true,
    createdAt: NOW,
    updatedAt: NOW,
    createdById: USER_ID,
  };
}

function jobRow(id: string, operation: BackupJobOperation, status: BackupJobStatus, sourceJobId: string | undefined = undefined) {
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
    createdAt: NOW,
    planId: null,
    destinationId: DESTINATION_ID,
    sourceJobId: sourceJobId ?? null,
    requestedById: USER_ID,
  };
}
