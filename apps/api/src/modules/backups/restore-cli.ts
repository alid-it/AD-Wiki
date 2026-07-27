import { chown, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  BackupOperationError,
  parseBackupMounts,
  postgresEnvironment,
  runCommand,
  verifyBackupDirectory,
  type BackupManifest,
  type CommandRunner,
} from "@/modules/backups/backup-artifact";

interface RestoreOptions {
  mountName: string;
  relativeBackupPath: string;
  dryRun: boolean;
  confirmation?: string;
}

export interface RestoreExecutionRecord {
  status: "dry_run_succeeded" | "succeeded" | "failed";
  backupId: string | null;
  restorePath: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  errorCode: string | null;
}

export type RestoreExecutionRecorder = (record: RestoreExecutionRecord) => Promise<void>;

const HELP = `AD-Wiki Restore

Verwendung:
  restore --mount local --backup <relativer-pfad> --dry-run
  restore --mount local --backup <relativer-pfad> --confirm <backup-id>

Ein echter Restore ist destruktiv. API und Backup-Worker müssen vorher gestoppt sein.
`;

export async function runRestoreCli(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  execute: CommandRunner = runCommand,
  recorder: RestoreExecutionRecorder = async () => undefined,
): Promise<string> {
  const startedAt = new Date();
  if (args.includes("--help") || args.includes("-h")) return HELP;
  const options = parseArguments(args);
  const mounts = parseBackupMounts(environment.BACKUP_MOUNTS_JSON);
  const mountRoot = mounts.get(options.mountName);
  if (!mountRoot) {
    throw new BackupOperationError("BACKUP_MOUNT_UNKNOWN", "Der angegebene Backup-Mount ist nicht konfiguriert.");
  }
  const backupDirectory = resolveRelativePath(mountRoot, options.relativeBackupPath);
  const manifest = await verifyBackupDirectory(backupDirectory);
  const databaseUrl = environment.DATABASE_URL?.trim();
  const uploadsDirectory = environment.BACKUP_UPLOADS_DIR?.trim();
  if (!databaseUrl) throw new BackupOperationError("DATABASE_URL_MISSING", "DATABASE_URL ist nicht gesetzt.");
  if (!uploadsDirectory) {
    throw new BackupOperationError("UPLOADS_PATH_MISSING", "BACKUP_UPLOADS_DIR ist nicht gesetzt.");
  }

  await verifyNativeArchives(backupDirectory, databaseUrl, execute);
  if (options.dryRun) {
    await recorder(successRecord("dry_run_succeeded", manifest.backupId, options.relativeBackupPath, startedAt));
    return `Dry-Run erfolgreich: Backup ${manifest.backupId} ist vollständig und lesbar.\n`;
  }
  if (options.confirmation !== manifest.backupId) {
    throw new BackupOperationError(
      "RESTORE_CONFIRMATION_REQUIRED",
      `Restore abgelehnt. Wiederholen Sie den Befehl mit --confirm ${manifest.backupId}.`,
    );
  }

  await restoreUploadsAndDatabase({
    backupDirectory,
    uploadsDirectory,
    databaseUrl,
    manifest,
    uploadsOwner: parseUploadsOwner(environment),
  }, execute);
  await recorder(successRecord("succeeded", manifest.backupId, options.relativeBackupPath, startedAt));
  return `Restore ${manifest.backupId} erfolgreich abgeschlossen; Migrationen wurden angewendet.\n`;
}

function successRecord(
  status: "dry_run_succeeded" | "succeeded",
  backupId: string,
  restorePath: string,
  startedAt: Date,
): RestoreExecutionRecord {
  const finishedAt = new Date();
  return {
    status,
    backupId,
    restorePath,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    errorCode: null,
  };
}

export async function verifyNativeArchives(
  backupDirectory: string,
  databaseUrl: string,
  execute: CommandRunner,
): Promise<void> {
  const databaseFile = path.join(backupDirectory, "database.dump");
  const uploadsFile = path.join(backupDirectory, "uploads.tar.gz");
  await execute("pg_restore", ["--list", databaseFile], {
    env: postgresEnvironment(databaseUrl),
  }).catch((error: unknown) => {
    throw new BackupOperationError("DATABASE_DUMP_INVALID", "Der PostgreSQL-Dump ist nicht lesbar.", { cause: error });
  });
  const listing = await execute("tar", [
    "--list",
    "--gzip",
    "--quoting-style=escape",
    `--file=${uploadsFile}`,
  ]).catch((error: unknown) => {
    throw new BackupOperationError("UPLOAD_ARCHIVE_INVALID", "Das Upload-Archiv ist nicht lesbar.", { cause: error });
  });
  validateArchiveListing(listing.stdout);
  const verboseListing = await execute("tar", [
    "--list",
    "--verbose",
    "--gzip",
    "--quoting-style=escape",
    `--file=${uploadsFile}`,
  ]).catch((error: unknown) => {
    throw new BackupOperationError("UPLOAD_ARCHIVE_INVALID", "Die Dateitypen im Upload-Archiv sind nicht lesbar.", { cause: error });
  });
  validateArchiveTypes(verboseListing.stdout);
}

async function restoreUploadsAndDatabase(
  input: {
    backupDirectory: string;
    uploadsDirectory: string;
    databaseUrl: string;
    manifest: BackupManifest;
    uploadsOwner: { uid: number; gid: number };
  },
  execute: CommandRunner,
): Promise<void> {
  const uploadsRoot = path.resolve(input.uploadsDirectory);
  await mkdir(uploadsRoot, { recursive: true });
  const stagingName = `.ad-wiki-restore-${input.manifest.backupId}`;
  const stagingDirectory = path.join(uploadsRoot, stagingName);
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: false });

  try {
    await execute("tar", [
      "--extract",
      "--gzip",
      `--file=${path.join(input.backupDirectory, "uploads.tar.gz")}`,
      `--directory=${stagingDirectory}`,
      "--no-same-owner",
      "--no-same-permissions",
    ]).catch((error: unknown) => {
      throw new BackupOperationError("UPLOAD_EXTRACT_FAILED", "Das Upload-Archiv konnte nicht entpackt werden.", { cause: error });
    });
    await assertTreeContainsNoLinks(stagingDirectory);

    const pgEnvironment = postgresEnvironment(input.databaseUrl);
    await execute("pg_restore", [
      "--exit-on-error",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      `--dbname=${pgEnvironment.PGDATABASE}`,
      path.join(input.backupDirectory, "database.dump"),
    ], { env: pgEnvironment }).catch((error: unknown) => {
      throw new BackupOperationError("DATABASE_RESTORE_FAILED", "Die PostgreSQL-Wiederherstellung ist fehlgeschlagen.", { cause: error });
    });

    await replaceDirectoryContents(uploadsRoot, stagingDirectory, stagingName);
    await execute("npx", ["prisma", "migrate", "deploy"], {
      cwd: "/app/apps/api",
      env: { ...process.env, DATABASE_URL: input.databaseUrl },
    }).catch((error: unknown) => {
      throw new BackupOperationError("DATABASE_MIGRATION_FAILED", "Migrationen nach dem Restore sind fehlgeschlagen.", { cause: error });
    });
    await chownTree(uploadsRoot, input.uploadsOwner.uid, input.uploadsOwner.gid);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

function parseArguments(args: readonly string[]): RestoreOptions {
  let mountName: string | undefined;
  let relativeBackupPath: string | undefined;
  let confirmation: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--mount" || argument === "--backup" || argument === "--confirm") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new BackupOperationError("RESTORE_ARGUMENTS_INVALID", `Für ${argument} fehlt ein Wert.`);
      }
      if (argument === "--mount") mountName = value;
      if (argument === "--backup") relativeBackupPath = value;
      if (argument === "--confirm") confirmation = value;
      index += 1;
      continue;
    }
    throw new BackupOperationError("RESTORE_ARGUMENTS_INVALID", `Unbekanntes Argument: ${argument}`);
  }
  if (!mountName || !/^[a-z0-9][a-z0-9_-]*$/.test(mountName) || !relativeBackupPath) {
    throw new BackupOperationError(
      "RESTORE_ARGUMENTS_INVALID",
      "--mount und --backup müssen mit gültigen Werten angegeben werden.",
    );
  }
  if (dryRun && confirmation) {
    throw new BackupOperationError("RESTORE_ARGUMENTS_INVALID", "--dry-run und --confirm dürfen nicht kombiniert werden.");
  }
  return { mountName, relativeBackupPath, dryRun, confirmation };
}

function resolveRelativePath(root: string, relativePath: string): string {
  if (
    path.isAbsolute(relativePath)
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Der Backup-Pfad muss sicher und relativ sein.");
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Der Backup-Pfad liegt außerhalb des Mounts.");
  }
  return resolved;
}

function validateArchiveListing(listing: string): void {
  for (const rawEntry of listing.split("\n").filter(Boolean)) {
    const entry = rawEntry.replace(/^\.\//, "").replace(/\/$/, "");
    if (!entry) continue;
    if (
      path.posix.isAbsolute(entry)
      || entry.includes("\\")
      || entry.includes("\0")
      || entry.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new BackupOperationError("UPLOAD_ARCHIVE_UNSAFE", "Das Upload-Archiv enthält einen unsicheren Pfad.");
    }
  }
}

function validateArchiveTypes(listing: string): void {
  for (const entry of listing.split("\n").filter(Boolean)) {
    const type = entry[0];
    if (type !== "-" && type !== "d") {
      throw new BackupOperationError(
        "UPLOAD_ARCHIVE_UNSAFE",
        "Das Upload-Archiv enthält Links oder einen unzulässigen Dateityp.",
      );
    }
  }
}

async function assertTreeContainsNoLinks(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) {
      throw new BackupOperationError("UPLOAD_ARCHIVE_UNSAFE", "Das Upload-Archiv enthält symbolische Links.");
    }
    if (info.isDirectory()) await assertTreeContainsNoLinks(entryPath);
    else if (!info.isFile()) {
      throw new BackupOperationError("UPLOAD_ARCHIVE_UNSAFE", "Das Upload-Archiv enthält einen unzulässigen Dateityp.");
    }
  }
}

async function replaceDirectoryContents(root: string, staging: string, stagingName: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name !== stagingName) {
      await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of await readdir(staging, { withFileTypes: true })) {
    await rename(path.join(staging, entry.name), path.join(root, entry.name));
  }
}

function parseUploadsOwner(environment: NodeJS.ProcessEnv): { uid: number; gid: number } {
  const uid = Number(environment.BACKUP_UPLOAD_OWNER_UID ?? "1000");
  const gid = Number(environment.BACKUP_UPLOAD_OWNER_GID ?? "1000");
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new BackupOperationError(
      "UPLOAD_OWNER_INVALID",
      "BACKUP_UPLOAD_OWNER_UID und BACKUP_UPLOAD_OWNER_GID müssen nichtnegative Ganzzahlen sein.",
    );
  }
  return { uid, gid };
}

async function chownTree(entryPath: string, uid: number, gid: number): Promise<void> {
  const info = await lstat(entryPath);
  if (info.isSymbolicLink()) {
    throw new BackupOperationError("UPLOAD_ARCHIVE_UNSAFE", "Symbolische Links werden nicht übernommen.");
  }
  if (info.isDirectory()) {
    for (const entry of await readdir(entryPath)) {
      await chownTree(path.join(entryPath, entry), uid, gid);
    }
  }
  await chown(entryPath, uid, gid);
}

async function main(): Promise<void> {
  const startedAt = new Date();
  try {
    process.stdout.write(await runRestoreCli(process.argv.slice(2), process.env, runCommand, recordRestoreAudit));
  } catch (error) {
    const code = error instanceof BackupOperationError ? error.code : "RESTORE_UNEXPECTED_ERROR";
    const message = error instanceof Error ? error.message : "Unbekannter Restore-Fehler.";
    const finishedAt = new Date();
    await recordRestoreAudit({
      status: "failed",
      backupId: null,
      restorePath: null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      errorCode: code,
    });
    process.stderr.write(`[${code}] ${message}\n`);
    process.exitCode = 1;
  }
}

async function recordRestoreAudit(record: RestoreExecutionRecord): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await prisma.auditLog.create({
      data: {
        action: `backup_restore.${record.status}`,
        resource: "backup",
        resourceId: record.backupId,
        details: {
          restorePath: record.restorePath,
          startedAt: record.startedAt,
          finishedAt: record.finishedAt,
          durationMs: record.durationMs,
          errorCode: record.errorCode,
        } satisfies Prisma.InputJsonObject,
      },
    });
  } catch {
    process.stderr.write("[RESTORE_AUDIT_FAILED] Das Restore-Ergebnis konnte nicht im Audit-Log gespeichert werden.\n");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
