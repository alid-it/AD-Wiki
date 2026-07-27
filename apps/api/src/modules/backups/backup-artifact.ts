import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { MountedBackupConfig } from "@ad-wiki/shared-types";

const REQUIRED_ARTIFACT_FILES = ["database.dump", "uploads.tar.gz", "manifest.json"] as const;
const CHECKSUM_FILE = "SHA256SUMS";
export const BACKUP_ARTIFACT_FILES = [...REQUIRED_ARTIFACT_FILES, CHECKSUM_FILE] as const;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;

const ManifestFileSchema = z.object({
  path: z.enum(["database.dump", "uploads.tar.gz"]),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const BackupManifestSchema = z.object({
  formatVersion: z.literal(1),
  backupId: z.string().uuid(),
  createdAt: z.string().datetime(),
  application: z.literal("ad-wiki"),
  database: z.object({
    file: z.literal("database.dump"),
    format: z.literal("postgresql-custom"),
  }).strict(),
  uploads: z.object({
    file: z.literal("uploads.tar.gz"),
    format: z.literal("tar-gzip"),
  }).strict(),
  files: z.array(ManifestFileSchema).length(2),
}).strict();

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface CreatedBackupArtifact {
  directory: string;
  relativeDirectory: string;
  size: bigint;
  checksum: string;
  manifest: BackupManifest;
}

export class BackupOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackupOperationError";
  }
}

/** Führt ein Programm ohne Shell aus und begrenzt dessen gepufferten Output. */
export const runCommand: CommandRunner = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

  child.stdout.on("data", (chunk: Buffer) => {
    if (stdoutBytes < MAX_COMMAND_OUTPUT_BYTES) stdout.push(chunk);
    stdoutBytes += chunk.length;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderrBytes < MAX_COMMAND_OUTPUT_BYTES) stderr.push(chunk);
    stderrBytes += chunk.length;
  });
  child.on("error", reject);
  child.on("close", (code, signal) => {
    const result = {
      stdout: Buffer.concat(stdout).subarray(0, MAX_COMMAND_OUTPUT_BYTES).toString("utf8"),
      stderr: Buffer.concat(stderr).subarray(0, MAX_COMMAND_OUTPUT_BYTES).toString("utf8"),
    };
    if (code === 0) resolve(result);
    else reject(new Error(`${command} wurde mit Code ${code ?? "?"} beziehungsweise Signal ${signal ?? "-"} beendet.`));
  });
});

/** Liest die explizite Zuordnung erlaubter Mount-Namen zu Containerpfaden. */
export function parseBackupMounts(raw: string | undefined): ReadonlyMap<string, string> {
  if (!raw) {
    throw new BackupOperationError("BACKUP_MOUNTS_MISSING", "BACKUP_MOUNTS_JSON ist nicht gesetzt.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BackupOperationError(
      "BACKUP_MOUNTS_INVALID",
      "BACKUP_MOUNTS_JSON enthält kein gültiges JSON.",
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BackupOperationError("BACKUP_MOUNTS_INVALID", "BACKUP_MOUNTS_JSON muss ein Objekt sein.");
  }

  const mounts = new Map<string, string>();
  for (const [name, value] of Object.entries(parsed)) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || typeof value !== "string" || !path.isAbsolute(value)) {
      throw new BackupOperationError(
        "BACKUP_MOUNTS_INVALID",
        "Jeder Backup-Mount benötigt einen gültigen Namen und einen absoluten Containerpfad.",
      );
    }
    mounts.set(name, path.resolve(value));
  }
  if (mounts.size === 0) {
    throw new BackupOperationError("BACKUP_MOUNTS_INVALID", "Mindestens ein Backup-Mount ist erforderlich.");
  }
  return mounts;
}

/** Löst ausschließlich bereits konfigurierte Mounts und sichere Unterverzeichnisse auf. */
export function resolveMountedDestination(
  config: MountedBackupConfig,
  mounts: ReadonlyMap<string, string>,
): string {
  const mountRoot = mounts.get(config.mountName);
  if (!mountRoot) {
    throw new BackupOperationError(
      "BACKUP_MOUNT_UNKNOWN",
      `Der Backup-Mount '${config.mountName}' ist im Worker nicht konfiguriert.`,
    );
  }
  const destination = path.resolve(mountRoot, config.subdirectory || ".");
  const relative = path.relative(mountRoot, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Das Backup-Ziel liegt außerhalb des erlaubten Mounts.");
  }
  return destination;
}

/** Loest einen gespeicherten logischen Artefaktpfad sicher innerhalb der Mount-Allowlist auf. */
export function resolveLogicalArtifactPath(
  logicalPath: string,
  mounts: ReadonlyMap<string, string>,
): string {
  const segments = logicalPath.split("/");
  const mountName = segments.shift();
  const mountRoot = mountName ? mounts.get(mountName) : undefined;
  if (!mountRoot || segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Der gespeicherte Backup-Pfad ist ungueltig.");
  }
  const target = path.resolve(mountRoot, ...segments);
  const relative = path.relative(mountRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Der gespeicherte Backup-Pfad liegt ausserhalb des Mounts.");
  }
  return target;
}

/** Erstellt Dump, Upload-Archiv, Manifest und Prüfsummen und veröffentlicht danach atomar. */
export async function createLocalBackupArtifact(
  input: {
    backupId: string;
    destinationDirectory: string;
    uploadsDirectory: string;
    databaseUrl: string;
    now?: Date;
  },
  execute: CommandRunner = runCommand,
): Promise<CreatedBackupArtifact> {
  const createdAt = input.now ?? new Date();
  const timestamp = createdAt.toISOString().replace(/[-:.]/g, "");
  const directoryName = `ad-wiki-${timestamp}-${input.backupId}`;
  const partialDirectory = path.join(input.destinationDirectory, `${directoryName}.partial`);
  const finalDirectory = path.join(input.destinationDirectory, directoryName);

  await mkdir(input.destinationDirectory, { recursive: true });
  await mkdir(partialDirectory, { recursive: false });

  const databaseFile = path.join(partialDirectory, "database.dump");
  const uploadsFile = path.join(partialDirectory, "uploads.tar.gz");
  try {
    await execute("pg_dump", [
      "--format=custom",
      "--compress=6",
      "--no-owner",
      "--no-privileges",
      `--file=${databaseFile}`,
    ], { env: postgresEnvironment(input.databaseUrl) }).catch((error: unknown) => {
      throw new BackupOperationError("PG_DUMP_FAILED", "Der PostgreSQL-Dump ist fehlgeschlagen.", { cause: error });
    });
    await execute("tar", [
      "--create",
      "--gzip",
      `--file=${uploadsFile}`,
      `--directory=${input.uploadsDirectory}`,
      ".",
    ]).catch((error: unknown) => {
      throw new BackupOperationError("UPLOAD_ARCHIVE_FAILED", "Das Upload-Archiv ist fehlgeschlagen.", { cause: error });
    });

    const artifactFiles = await Promise.all([
      describeFile(databaseFile, "database.dump"),
      describeFile(uploadsFile, "uploads.tar.gz"),
    ]);
    const manifest: BackupManifest = {
      formatVersion: 1,
      backupId: input.backupId,
      createdAt: createdAt.toISOString(),
      application: "ad-wiki",
      database: { file: "database.dump", format: "postgresql-custom" },
      uploads: { file: "uploads.tar.gz", format: "tar-gzip" },
      files: artifactFiles,
    };
    await writeFile(
      path.join(partialDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o640 },
    );

    const checksumLines = await Promise.all(REQUIRED_ARTIFACT_FILES.map(async (fileName) => (
      `${await sha256File(path.join(partialDirectory, fileName))}  ${fileName}`
    )));
    await writeFile(
      path.join(partialDirectory, CHECKSUM_FILE),
      `${checksumLines.join("\n")}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o640 },
    );

    await verifyBackupDirectory(partialDirectory, { allowPartial: true });
    const checksum = await sha256File(path.join(partialDirectory, CHECKSUM_FILE));
    const size = await sumArtifactSize(partialDirectory);
    await rename(partialDirectory, finalDirectory);
    return {
      directory: finalDirectory,
      relativeDirectory: directoryName,
      size,
      checksum,
      manifest,
    };
  } catch (error) {
    if (error instanceof BackupOperationError) throw error;
    throw new BackupOperationError(
      "BACKUP_ARTIFACT_FAILED",
      "Das Backup-Artefakt konnte nicht vollständig erstellt werden.",
      { cause: error },
    );
  }
}

/** Prüft Format, Dateitypen, Manifest und alle gespeicherten SHA-256-Werte. */
export async function verifyBackupDirectory(
  directory: string,
  options: { allowPartial?: boolean } = {},
): Promise<BackupManifest> {
  const root = await stat(directory);
  if (
    !root.isDirectory()
    || root.isSymbolicLink()
    || (!options.allowPartial && directory.endsWith(".partial"))
  ) {
    throw new BackupOperationError("BACKUP_INCOMPLETE", "Unvollständige oder ungültige Backups werden abgelehnt.");
  }

  for (const fileName of [...REQUIRED_ARTIFACT_FILES, CHECKSUM_FILE]) {
    const file = await stat(path.join(directory, fileName));
    if (!file.isFile() || file.isSymbolicLink()) {
      throw new BackupOperationError("BACKUP_FILE_INVALID", `Die Backup-Datei '${fileName}' ist ungültig.`);
    }
  }

  const expected = parseChecksums(await readFile(path.join(directory, CHECKSUM_FILE), "utf8"));
  for (const fileName of REQUIRED_ARTIFACT_FILES) {
    const actual = await sha256File(path.join(directory, fileName));
    if (expected.get(fileName) !== actual) {
      throw new BackupOperationError("BACKUP_CHECKSUM_MISMATCH", `Prüfsumme für '${fileName}' stimmt nicht überein.`);
    }
  }

  let manifest: BackupManifest;
  try {
    manifest = BackupManifestSchema.parse(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")));
  } catch (error) {
    throw new BackupOperationError("BACKUP_MANIFEST_INVALID", "Das Backup-Manifest ist ungültig.", { cause: error });
  }
  for (const entry of manifest.files) {
    const current = await describeFile(path.join(directory, entry.path), entry.path);
    if (current.size !== entry.size || current.sha256 !== entry.sha256) {
      throw new BackupOperationError("BACKUP_MANIFEST_MISMATCH", `Manifestdaten für '${entry.path}' stimmen nicht überein.`);
    }
  }
  if (new Set(manifest.files.map((entry) => entry.path)).size !== 2) {
    throw new BackupOperationError("BACKUP_MANIFEST_INVALID", "Das Backup-Manifest enthält doppelte Dateieinträge.");
  }
  return manifest;
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function describeFile(
  filePath: string,
  artifactPath: "database.dump" | "uploads.tar.gz",
): Promise<z.infer<typeof ManifestFileSchema>> {
  const file = await stat(filePath);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new BackupOperationError("BACKUP_FILE_INVALID", `Die Backup-Datei '${artifactPath}' wurde nicht erzeugt.`);
  }
  return { path: artifactPath, size: file.size, sha256: await sha256File(filePath) };
}

function parseChecksums(content: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const lines = content.trimEnd().split("\n");
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (database\.dump|uploads\.tar\.gz|manifest\.json)$/.exec(line.trimEnd());
    if (!match || result.has(match[2])) {
      throw new BackupOperationError("BACKUP_CHECKSUM_FILE_INVALID", "Die Prüfsummendatei ist ungültig.");
    }
    result.set(match[2], match[1]);
  }
  if (result.size !== REQUIRED_ARTIFACT_FILES.length) {
    throw new BackupOperationError("BACKUP_CHECKSUM_FILE_INVALID", "Die Prüfsummendatei ist unvollständig.");
  }
  return result;
}

async function sumArtifactSize(directory: string): Promise<bigint> {
  let size = 0n;
  for (const fileName of [...REQUIRED_ARTIFACT_FILES, CHECKSUM_FILE]) {
    size += BigInt((await stat(path.join(directory, fileName))).size);
  }
  return size;
}

/** Übergibt das Passwort ausschließlich über die Prozessumgebung, nicht über die Kommandozeile. */
export function postgresEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new BackupOperationError("DATABASE_URL_INVALID", "DATABASE_URL ist ungültig.", { cause: error });
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new BackupOperationError("DATABASE_URL_INVALID", "DATABASE_URL muss PostgreSQL verwenden.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !parsed.username || !database) {
    throw new BackupOperationError("DATABASE_URL_INVALID", "DATABASE_URL ist unvollständig.");
  }
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
    ...(parsed.searchParams.get("sslmode") ? { PGSSLMODE: parsed.searchParams.get("sslmode") ?? undefined } : {}),
  };
}
