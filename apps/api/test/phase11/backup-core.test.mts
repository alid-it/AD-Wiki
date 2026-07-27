import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BackupDestinationType,
  BackupJobOperation,
  BackupJobStatus,
  BackupJobTrigger,
} from "@prisma/client";
import { StartBackupJobSchema } from "@ad-wiki/shared-types";
import {
  createLocalBackupArtifact,
  parseBackupMounts,
  resolveMountedDestination,
  verifyBackupDirectory,
  type CommandRunner,
} from "../../dist/modules/backups/backup-artifact.js";
import { runRestoreCli, type RestoreExecutionRecord } from "../../dist/modules/backups/restore-cli.js";
import { BackupJobWorkerService } from "../../dist/backup-worker/backup-job-worker.service.js";
import { BackupsService } from "../../dist/modules/backups/backups.service.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "20000000-0000-4000-8000-000000000002";
const JOB_ID = "30000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-07-22T08:00:00.000Z");

test("manueller Backup-Vertrag verlangt genau ein Ziel oder einen Plan", () => {
  assert.equal(StartBackupJobSchema.safeParse({ destinationId: DESTINATION_ID }).success, true);
  assert.equal(StartBackupJobSchema.safeParse({ planId: DESTINATION_ID }).success, true);
  assert.equal(StartBackupJobSchema.safeParse({}).success, false);
  assert.equal(StartBackupJobSchema.safeParse({ destinationId: DESTINATION_ID, planId: DESTINATION_ID }).success, false);
});

test("Mount-Auflösung bleibt innerhalb explizit freigegebener Containerpfade", () => {
  const mounts = parseBackupMounts(JSON.stringify({ local: "/data/backups" }));
  assert.equal(
    resolveMountedDestination({ mountName: "local", subdirectory: "daily/wiki" }, mounts),
    path.resolve("/data/backups/daily/wiki"),
  );
  assert.throws(
    () => resolveMountedDestination({ mountName: "unknown", subdirectory: "" }, mounts),
    /nicht konfiguriert/,
  );
  assert.throws(() => parseBackupMounts(JSON.stringify({ local: "relative" })), /absoluten/);
});

test("Backup wird erst vollständig geprüft und danach ohne partial-Suffix veröffentlicht", async () => {
  const fixture = await createArtifactFixture();
  try {
    const entries = await readdir(fixture.destination);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].endsWith(".partial"), false);
    const manifest = await verifyBackupDirectory(fixture.artifact.directory);
    assert.equal(manifest.backupId, JOB_ID);
    assert.match(fixture.artifact.checksum, /^[a-f0-9]{64}$/);
    assert.equal(fixture.artifact.size > 0n, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("veränderte Backup-Dateien werden vor einem Restore abgelehnt", async () => {
  const fixture = await createArtifactFixture();
  try {
    await writeFile(path.join(fixture.artifact.directory, "database.dump"), "manipuliert", "utf8");
    await assert.rejects(() => verifyBackupDirectory(fixture.artifact.directory), /Prüfsumme/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Restore-Dry-Run prüft beide nativen Archive ohne Daten zu verändern", async () => {
  const fixture = await createArtifactFixture();
  const commands: string[] = [];
  const records: RestoreExecutionRecord[] = [];
  const execute: CommandRunner = async (command, args) => {
    commands.push(`${command} ${args.join(" ")}`);
    if (command === "tar" && args.includes("--list")) {
      return {
        stdout: args.includes("--verbose")
          ? "drwxr-xr-x user/group 0 2026-07-22 08:00 ./\n-rw-r--r-- user/group 6 2026-07-22 08:00 ./logo.png\n"
          : "./\n./logo.png\n",
        stderr: "",
      };
    }
    return { stdout: "ok", stderr: "" };
  };
  try {
    const output = await runRestoreCli([
      "--mount", "local",
      "--backup", fixture.artifact.relativeDirectory,
      "--dry-run",
    ], {
      BACKUP_MOUNTS_JSON: JSON.stringify({ local: fixture.destination }),
      BACKUP_UPLOADS_DIR: fixture.uploads,
      DATABASE_URL: "postgresql://adwiki:secret@postgres:5432/adwiki_wiki",
    }, execute, async (record) => { records.push(record); });
    assert.match(output, /Dry-Run erfolgreich/);
    assert.equal(commands.some((command) => command.startsWith("pg_restore --list")), true);
    assert.equal(commands.some((command) => command.startsWith("tar --list")), true);
    assert.equal(commands.some((command) => command.includes("--extract")), false);
    assert.equal(records[0]?.status, "dry_run_succeeded");
    assert.equal(records[0]?.backupId, JOB_ID);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("echter Restore verlangt die exakte ID aus dem geprüften Manifest", async () => {
  const fixture = await createArtifactFixture();
  const execute: CommandRunner = async (command, args) => ({
    stdout: command === "tar" && args.includes("--list")
      ? (args.includes("--verbose") ? "drwxr-xr-x user/group 0 2026-07-22 08:00 ./\n" : "./\n")
      : "ok",
    stderr: "",
  });
  try {
    await assert.rejects(() => runRestoreCli([
      "--mount", "local",
      "--backup", fixture.artifact.relativeDirectory,
      "--confirm", DESTINATION_ID,
    ], {
      BACKUP_MOUNTS_JSON: JSON.stringify({ local: fixture.destination }),
      BACKUP_UPLOADS_DIR: fixture.uploads,
      DATABASE_URL: "postgresql://adwiki:secret@postgres:5432/adwiki_wiki",
    }, execute), /Restore abgelehnt/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Restore lehnt symbolische Links bereits vor dem Entpacken ab", async () => {
  const fixture = await createArtifactFixture();
  const execute: CommandRunner = async (command, args) => ({
    stdout: command === "tar" && args.includes("--verbose")
      ? "lrwxrwxrwx user/group 0 2026-07-22 08:00 ./escape -> /etc\n"
      : (command === "tar" ? "./escape\n" : "ok"),
    stderr: "",
  });
  try {
    await assert.rejects(() => runRestoreCli([
      "--mount", "local",
      "--backup", fixture.artifact.relativeDirectory,
      "--dry-run",
    ], {
      BACKUP_MOUNTS_JSON: JSON.stringify({ local: fixture.destination }),
      BACKUP_UPLOADS_DIR: fixture.uploads,
      DATABASE_URL: "postgresql://adwiki:secret@postgres:5432/adwiki_wiki",
    }, execute), /Links oder einen unzulässigen Dateityp/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("API legt einen lokalen manuellen Auftrag zunächst als queued an", async () => {
  let createData: Record<string, unknown> | undefined;
  const service = new BackupsService({
    backupPlan: { findUnique: async () => null },
    backupDestination: {
      findUnique: async () => ({
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
      }),
    },
    backupJob: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createData = data;
        return {
          id: JOB_ID,
          operation: BackupJobOperation.BACKUP,
          trigger: BackupJobTrigger.MANUAL,
          status: BackupJobStatus.QUEUED,
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
          sourceJobId: null,
          requestedById: USER_ID,
        };
      },
    },
  } as unknown as ConstructorParameters<typeof BackupsService>[0], {} as ConstructorParameters<typeof BackupsService>[1]);

  const job = await service.startBackupJob(USER_ID, { destinationId: DESTINATION_ID });
  assert.equal(job.status, "queued");
  assert.equal(createData?.destinationId, DESTINATION_ID);
  assert.equal(createData?.requestedById, USER_ID);
});

test("Worker markiert nicht unterstützte Ziele mit redigiertem Fehlercode", async () => {
  let failedData: Record<string, unknown> | undefined;
  const candidate = {
    id: JOB_ID,
    operation: BackupJobOperation.BACKUP,
    trigger: BackupJobTrigger.MANUAL,
    status: BackupJobStatus.QUEUED,
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
    sourceJobId: null,
    sourceJob: null,
    requestedById: USER_ID,
    destination: {
      id: DESTINATION_ID,
      name: "S3",
      type: BackupDestinationType.S3,
      config: {},
      encryptedCredentials: "darf-nicht-erscheinen",
      isEnabled: true,
      lastTestedAt: null,
      lastTestSucceeded: null,
      createdAt: NOW,
      updatedAt: NOW,
      createdById: USER_ID,
    },
  };
  const worker = new BackupJobWorkerService({
    backupJob: {
      findFirst: async () => candidate,
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        failedData = data;
        return candidate;
      },
    },
    auditLog: { create: async () => ({}) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as ConstructorParameters<typeof BackupJobWorkerService>[0]);

  assert.equal(await worker.processNextJob(), true);
  assert.equal(failedData?.status, BackupJobStatus.FAILED);
  assert.equal(failedData?.errorCode, "BACKUP_DESTINATION_UNSUPPORTED");
  assert.equal(JSON.stringify(failedData).includes("darf-nicht-erscheinen"), false);
});

async function createArtifactFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ad-wiki-backup-test-"));
  const destination = path.join(root, "backups");
  const uploads = path.join(root, "uploads");
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, "logo.png"), "upload", "utf8");
  const execute: CommandRunner = async (command, args) => {
    const output = args.find((argument) => argument.startsWith("--file="))?.slice("--file=".length);
    if (!output) throw new Error(`Ausgabepfad für ${command} fehlt.`);
    await writeFile(output, command === "pg_dump" ? "postgres-dump" : "uploads-archive", "utf8");
    return { stdout: "", stderr: "" };
  };
  const artifact = await createLocalBackupArtifact({
    backupId: JOB_ID,
    destinationDirectory: destination,
    uploadsDirectory: uploads,
    databaseUrl: "postgresql://adwiki:secret@postgres:5432/adwiki_wiki",
    now: NOW,
  }, execute);
  return { root, destination, uploads, artifact };
}
