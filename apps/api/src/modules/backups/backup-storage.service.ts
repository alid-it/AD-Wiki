import { Injectable } from "@nestjs/common";
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Client as SshClient, type ConnectConfig, type SFTPWrapper } from "ssh2";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BackupDestination as PrismaBackupDestination } from "@prisma/client";
import {
  MountedBackupConfigSchema,
  S3BackupConfigSchema,
  S3BackupCredentialsSchema,
  SftpBackupConfigSchema,
  SftpBackupCredentialsSchema,
  type BackupDestinationType,
  type S3BackupConfig,
  type S3BackupCredentials,
  type SftpBackupConfig,
  type SftpBackupCredentials,
} from "@ad-wiki/shared-types";
import {
  BACKUP_ARTIFACT_FILES,
  BackupOperationError,
  parseBackupMounts,
  resolveMountedDestination,
  verifyBackupDirectory,
  type BackupManifest,
  type CreatedBackupArtifact,
} from "@/modules/backups/backup-artifact";
import { BackupEncryptionService } from "@/modules/backups/backup-encryption.service";

const COMPLETE_MARKER = "COMPLETE";
const STORAGE_TIMEOUT_MS = 30_000;

export interface BackupStorageAdapter {
  readonly type: BackupDestinationType;
  readonly isRemote: boolean;
  referenceFor(artifactName: string): string;
  publish(artifact: CreatedBackupArtifact): Promise<string>;
  verify(reference: string, stagingRoot: string): Promise<BackupManifest>;
  download(reference: string, targetRoot: string): Promise<{ directory: string; reference: string }>;
  delete(reference: string): Promise<void>;
  testConnection(): Promise<void>;
}

/** Erstellt ausschließlich validierte Adapter; entschlüsselte Secrets verlassen den Worker nie. */
@Injectable()
export class BackupStorageService {
  constructor(private readonly encryption: BackupEncryptionService) {}

  adapter(destination: PrismaBackupDestination): BackupStorageAdapter {
    switch (destination.type) {
      case "LOCAL": {
        const mounts = parseBackupMounts(process.env.BACKUP_MOUNTS_JSON);
        const config = MountedBackupConfigSchema.parse(destination.config);
        return new MountedStorageAdapter(
          "local",
          config.mountName,
          config.subdirectory,
          resolveMountedDestination(config, mounts),
        );
      }
      case "SFTP":
        return new SftpStorageAdapter(
          SftpBackupConfigSchema.parse(destination.config),
          SftpBackupCredentialsSchema.parse(this.credentials(destination)),
        );
      case "S3":
        return new S3StorageAdapter(
          S3BackupConfigSchema.parse(destination.config),
          S3BackupCredentialsSchema.parse(this.credentials(destination)),
        );
    }
  }

  stagingRoot(): string {
    const configured = process.env.BACKUP_STAGING_DIR?.trim() || "/data/staging";
    if (!path.isAbsolute(configured)) {
      throw new BackupOperationError("BACKUP_STAGING_INVALID", "BACKUP_STAGING_DIR muss absolut sein.");
    }
    return path.resolve(configured);
  }

  restoreTarget(): { adapter: BackupStorageAdapter; root: string } {
    const mounts = parseBackupMounts(process.env.BACKUP_MOUNTS_JSON);
    const mountName = process.env.BACKUP_RESTORE_MOUNT?.trim() || "local";
    const subdirectory = process.env.BACKUP_RESTORE_SUBDIRECTORY?.trim() || "restore";
    const config = MountedBackupConfigSchema.parse({ mountName, subdirectory });
    return {
      adapter: new MountedStorageAdapter(
        "local",
        mountName,
        subdirectory,
        resolveMountedDestination(config, mounts),
      ),
      root: resolveMountedDestination(config, mounts),
    };
  }

  private credentials(destination: PrismaBackupDestination): unknown {
    if (!destination.encryptedCredentials) {
      throw new BackupOperationError(
        "BACKUP_DESTINATION_CREDENTIALS_MISSING",
        "Für das Remote-Ziel sind keine Zugangsdaten hinterlegt.",
      );
    }
    try {
      return JSON.parse(this.encryption.decrypt(destination.encryptedCredentials));
    } catch (error) {
      if (error instanceof BackupOperationError) throw error;
      throw new BackupOperationError(
        "BACKUP_DESTINATION_CREDENTIALS_INVALID",
        "Die Zugangsdaten des Backup-Ziels sind ungültig.",
        { cause: error },
      );
    }
  }
}

abstract class GuardedAdapter implements BackupStorageAdapter {
  abstract readonly type: BackupDestinationType;
  abstract readonly isRemote: boolean;
  abstract referenceFor(artifactName: string): string;
  abstract publish(artifact: CreatedBackupArtifact): Promise<string>;
  abstract verify(reference: string, stagingRoot: string): Promise<BackupManifest>;
  abstract download(reference: string, targetRoot: string): Promise<{ directory: string; reference: string }>;
  abstract delete(reference: string): Promise<void>;
  abstract testConnection(): Promise<void>;

  protected async guarded<T>(operation: StorageOperation, task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      throw classifyStorageError(error, operation);
    }
  }
}

class MountedStorageAdapter extends GuardedAdapter {
  readonly isRemote = false;

  constructor(
    readonly type: "local",
    private readonly mountName: string,
    private readonly subdirectory: string,
    private readonly destinationRoot: string,
  ) {
    super();
  }

  publish(artifact: CreatedBackupArtifact): Promise<string> {
    return this.guarded("upload", async () => {
      const artifactName = safeArtifactName(artifact.relativeDirectory);
      await copyArtifactAtomically(artifact.directory, this.destinationRoot, artifactName);
      return this.referenceFor(artifactName);
    });
  }

  verify(reference: string): Promise<BackupManifest> {
    return this.guarded("download", () => verifyBackupDirectory(this.sourceDirectory(reference)));
  }

  download(reference: string, targetRoot: string): Promise<{ directory: string; reference: string }> {
    return this.guarded("download", async () => {
      const artifactName = this.artifactName(reference);
      const directory = await copyArtifactAtomically(this.sourceDirectory(reference), targetRoot, artifactName);
      return { directory, reference: artifactName };
    });
  }

  delete(reference: string): Promise<void> {
    return this.guarded("delete", () => rm(this.sourceDirectory(reference), { recursive: true, force: false }));
  }

  testConnection(): Promise<void> {
    return this.guarded("test", async () => {
      await mkdir(this.destinationRoot, { recursive: true });
      const marker = path.join(this.destinationRoot, `.ad-wiki-connection-test-${randomUUID()}`);
      const expected = randomBytes(64);
      try {
        await writeFile(marker, expected, { flag: "wx", mode: 0o600 });
        const actual = await readFile(marker);
        if (!sameBuffer(expected, actual)) throw new Error("checksum");
      } finally {
        await rm(marker, { force: true });
      }
    });
  }

  referenceFor(artifactName: string): string {
    return [this.mountName, this.subdirectory, safeArtifactName(artifactName)].filter(Boolean).join("/");
  }

  private artifactName(reference: string): string {
    const artifactName = safeArtifactName(path.posix.basename(reference));
    if (reference !== this.referenceFor(artifactName)) {
      throw new BackupOperationError("BACKUP_PATH_INVALID", "Der gespeicherte Mount-Pfad passt nicht zum Backup-Ziel.");
    }
    return artifactName;
  }

  private sourceDirectory(reference: string): string {
    return path.join(this.destinationRoot, this.artifactName(reference));
  }
}

class S3StorageAdapter extends GuardedAdapter {
  readonly type = "s3" as const;
  readonly isRemote = true;

  constructor(
    private readonly config: S3BackupConfig,
    private readonly credentials: S3BackupCredentials,
  ) {
    super();
  }

  referenceFor(artifactName: string): string {
    return safeArtifactName(artifactName);
  }

  publish(artifact: CreatedBackupArtifact): Promise<string> {
    return this.guarded("upload", async () => {
      const artifactName = safeArtifactName(artifact.relativeDirectory);
      const client = this.client();
      const partialPrefix = this.key(`${artifactName}.partial`);
      const finalPrefix = this.key(artifactName);
      let publishStarted = false;
      try {
        if (await s3ObjectExists(client, this.config.bucket, `${finalPrefix}/${COMPLETE_MARKER}`)) {
          throw new BackupOperationError("BACKUP_ARTIFACT_EXISTS", "Das Backup-Artefakt existiert am Ziel bereits.");
        }
        publishStarted = true;
        for (const fileName of BACKUP_ARTIFACT_FILES) {
          const localPath = path.join(artifact.directory, fileName);
          const file = await stat(localPath);
          await new Upload({
            client,
            leavePartsOnError: false,
            params: {
              Bucket: this.config.bucket,
              Key: `${partialPrefix}/${fileName}`,
              Body: createReadStream(localPath),
              ContentLength: file.size,
              ServerSideEncryption: this.config.serverSideEncryption,
              ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
            },
          }).done();
          const remote = await client.send(new HeadObjectCommand({
            Bucket: this.config.bucket,
            Key: `${partialPrefix}/${fileName}`,
          }));
          if (remote.ContentLength !== file.size) throw new Error("size");
        }
        for (const fileName of BACKUP_ARTIFACT_FILES) {
          await client.send(new CopyObjectCommand({
            Bucket: this.config.bucket,
            Key: `${finalPrefix}/${fileName}`,
            CopySource: s3CopySource(this.config.bucket, `${partialPrefix}/${fileName}`),
            ServerSideEncryption: this.config.serverSideEncryption,
            ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
          }));
        }
        await client.send(new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: `${finalPrefix}/${COMPLETE_MARKER}`,
          Body: `${artifact.checksum}\n`,
          ServerSideEncryption: this.config.serverSideEncryption,
          ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
        }));
        await this.deleteKeys(client, partialPrefix, false);
        return artifactName;
      } catch (error) {
        await this.deleteKeys(client, partialPrefix, true);
        if (publishStarted) await this.deleteKeys(client, finalPrefix, true);
        throw error;
      } finally {
        client.destroy();
      }
    });
  }

  verify(reference: string, stagingRoot: string): Promise<BackupManifest> {
    return this.guarded("download", async () => {
      const downloaded = await this.download(reference, stagingRoot);
      try {
        return await verifyBackupDirectory(downloaded.directory);
      } finally {
        await rm(downloaded.directory, { recursive: true, force: true });
      }
    });
  }

  download(reference: string, targetRoot: string): Promise<{ directory: string; reference: string }> {
    return this.guarded("download", async () => {
      const artifactName = safeArtifactName(reference);
      const client = this.client();
      const prefix = this.key(artifactName);
      try {
        await client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: `${prefix}/${COMPLETE_MARKER}` }));
        const directory = await prepareDownloadDirectory(targetRoot, artifactName);
        try {
          for (const fileName of BACKUP_ARTIFACT_FILES) {
            const response = await client.send(new GetObjectCommand({
              Bucket: this.config.bucket,
              Key: `${prefix}/${fileName}`,
            }));
            await writeS3Body(response.Body, path.join(`${directory}.partial`, fileName));
          }
          return { directory: await finalizeDownloadedDirectory(directory), reference: artifactName };
        } catch (error) {
          await rm(`${directory}.partial`, { recursive: true, force: true });
          throw error;
        }
      } finally {
        client.destroy();
      }
    });
  }

  delete(reference: string): Promise<void> {
    return this.guarded("delete", async () => {
      const client = this.client();
      try {
        await this.deleteKeys(client, this.key(safeArtifactName(reference)), false);
      } finally {
        client.destroy();
      }
    });
  }

  testConnection(): Promise<void> {
    return this.guarded("test", async () => {
      const client = this.client();
      const key = this.key(`.ad-wiki-connection-test-${randomUUID()}`);
      const expected = randomBytes(64);
      try {
        await client.send(new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: expected,
          ServerSideEncryption: this.config.serverSideEncryption,
          ...(this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
        }));
        const response = await client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
        const actual = await readSmallS3Body(response.Body);
        if (!sameBuffer(expected, actual)) throw new Error("checksum");
      } finally {
        await client.send(new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: [{ Key: key }], Quiet: true },
        })).catch(() => undefined);
        client.destroy();
      }
    });
  }

  private client(): S3Client {
    return new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: this.credentials,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  private key(suffix: string): string {
    return [this.config.prefix, suffix].filter(Boolean).join("/");
  }

  private async deleteKeys(client: S3Client, prefix: string, ignoreErrors: boolean): Promise<void> {
    const request = client.send(new DeleteObjectsCommand({
      Bucket: this.config.bucket,
      Delete: {
        Objects: [...BACKUP_ARTIFACT_FILES, COMPLETE_MARKER].map((fileName) => ({ Key: `${prefix}/${fileName}` })),
        Quiet: true,
      },
    }));
    if (ignoreErrors) await request.catch(() => undefined);
    else await request;
  }
}

class SftpStorageAdapter extends GuardedAdapter {
  readonly type = "sftp" as const;
  readonly isRemote = true;

  constructor(
    private readonly config: SftpBackupConfig,
    private readonly credentials: SftpBackupCredentials,
  ) {
    super();
  }

  referenceFor(artifactName: string): string {
    return safeArtifactName(artifactName);
  }

  publish(artifact: CreatedBackupArtifact): Promise<string> {
    return this.guarded("upload", () => this.withSftp(async (sftp) => {
      const artifactName = safeArtifactName(artifact.relativeDirectory);
      const partial = remoteJoin(this.config.basePath, `${artifactName}.partial`);
      const final = remoteJoin(this.config.basePath, artifactName);
      if (await sftpExists(sftp, final)) throw new BackupOperationError("BACKUP_ARTIFACT_EXISTS", "Das Backup-Artefakt existiert am Ziel bereits.");
      await sftpMkdirRecursive(sftp, partial);
      try {
        for (const fileName of BACKUP_ARTIFACT_FILES) {
          const localPath = path.join(artifact.directory, fileName);
          await sftpFastPut(sftp, localPath, remoteJoin(partial, fileName));
          const [localFile, remoteFile] = await Promise.all([stat(localPath), sftpStat(sftp, remoteJoin(partial, fileName))]);
          if (localFile.size !== remoteFile.size) throw new Error("size");
        }
        await sftpRename(sftp, partial, final);
        return artifactName;
      } catch (error) {
        await sftpRemoveArtifact(sftp, partial, true);
        throw error;
      }
    }));
  }

  verify(reference: string, stagingRoot: string): Promise<BackupManifest> {
    return this.guarded("download", async () => {
      const downloaded = await this.download(reference, stagingRoot);
      try {
        return await verifyBackupDirectory(downloaded.directory);
      } finally {
        await rm(downloaded.directory, { recursive: true, force: true });
      }
    });
  }

  download(reference: string, targetRoot: string): Promise<{ directory: string; reference: string }> {
    return this.guarded("download", () => this.withSftp(async (sftp) => {
      const artifactName = safeArtifactName(reference);
      const remoteDirectory = remoteJoin(this.config.basePath, artifactName);
      const directory = await prepareDownloadDirectory(targetRoot, artifactName);
      try {
        for (const fileName of BACKUP_ARTIFACT_FILES) {
          await sftpFastGet(sftp, remoteJoin(remoteDirectory, fileName), path.join(`${directory}.partial`, fileName));
        }
        return { directory: await finalizeDownloadedDirectory(directory), reference: artifactName };
      } catch (error) {
        await rm(`${directory}.partial`, { recursive: true, force: true });
        throw error;
      }
    }));
  }

  delete(reference: string): Promise<void> {
    return this.guarded("delete", () => this.withSftp((sftp) => (
      sftpRemoveArtifact(sftp, remoteJoin(this.config.basePath, safeArtifactName(reference)), false)
    )));
  }

  testConnection(): Promise<void> {
    return this.guarded("test", () => this.withSftp(async (sftp) => {
      await sftpMkdirRecursive(sftp, this.config.basePath);
      const remotePath = remoteJoin(this.config.basePath, `.ad-wiki-connection-test-${randomUUID()}`);
      const expected = randomBytes(64);
      try {
        await sftpWriteFile(sftp, remotePath, expected);
        const actual = await sftpReadFile(sftp, remotePath);
        if (!sameBuffer(expected, actual)) throw new Error("checksum");
      } finally {
        await sftpUnlink(sftp, remotePath, true);
      }
    }));
  }

  private async withSftp<T>(task: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    const client = new SshClient();
    let hostKeyRejected = false;
    const connection: ConnectConfig = {
      host: this.config.host.replace(/^\[|\]$/g, ""),
      port: this.config.port,
      username: this.config.username,
      readyTimeout: STORAGE_TIMEOUT_MS,
      timeout: STORAGE_TIMEOUT_MS,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 2,
      hostHash: "sha256",
      hostVerifier: (fingerprint: string) => {
        const accepted = fingerprintMatches(this.config.hostKeyFingerprint, fingerprint);
        hostKeyRejected = !accepted;
        return accepted;
      },
      ...(this.credentials.password ? { password: this.credentials.password } : {}),
      ...(this.credentials.privateKey ? { privateKey: this.credentials.privateKey } : {}),
      ...(this.credentials.passphrase ? { passphrase: this.credentials.passphrase } : {}),
    };
    try {
      await sshConnect(client, connection);
      const sftp = await sshSftp(client);
      return await task(sftp);
    } catch (error) {
      if (hostKeyRejected) {
        throw new BackupOperationError(
          "BACKUP_DESTINATION_HOST_KEY_MISMATCH",
          "Der SFTP-Host-Key stimmt nicht mit dem hinterlegten Fingerprint überein.",
          { cause: error },
        );
      }
      throw error;
    } finally {
      client.end();
    }
  }
}

type StorageOperation = "upload" | "download" | "delete" | "test";

function classifyStorageError(error: unknown, operation: StorageOperation): BackupOperationError {
  if (error instanceof BackupOperationError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "ENOSPC" || code === "EDQUOT" || /no space|quota exceeded|insufficient storage/i.test(message)) {
    return new BackupOperationError("BACKUP_DESTINATION_NO_SPACE", "Am Backup-Ziel ist nicht genügend Speicherplatz verfügbar.", { cause: error });
  }
  if (/auth|login|permission denied|access denied|invalidaccesskeyid|signaturedoesnotmatch|\b530\b/i.test(`${code} ${message}`)) {
    return new BackupOperationError("BACKUP_DESTINATION_AUTH_FAILED", "Die Anmeldung am Backup-Ziel ist fehlgeschlagen.", { cause: error });
  }
  if (/certificate|self[- ]signed|unable to verify|tls|ssl|cert_/i.test(`${code} ${message}`)) {
    return new BackupOperationError("BACKUP_DESTINATION_TLS_FAILED", "Die TLS-Zertifikatsprüfung des Backup-Ziels ist fehlgeschlagen.", { cause: error });
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|getaddrinfo|timeout/i.test(`${code} ${message}`)) {
    return new BackupOperationError("BACKUP_DESTINATION_UNREACHABLE", "Das Backup-Ziel ist nicht erreichbar.", { cause: error });
  }
  if (/checksum|\bsize\b/i.test(message)) {
    return new BackupOperationError("BACKUP_REMOTE_CHECKSUM_MISMATCH", "Der vom Backup-Ziel gelesene Inhalt stimmt nicht mit dem Upload überein.", { cause: error });
  }
  const descriptions: Record<StorageOperation, string> = {
    upload: "Das Backup konnte nicht vollständig am Ziel veröffentlicht werden.",
    download: "Das Backup konnte nicht vollständig vom Ziel heruntergeladen werden.",
    delete: "Das abgelaufene Backup konnte nicht vom Ziel entfernt werden.",
    test: "Der Verbindungstest des Backup-Ziels ist fehlgeschlagen.",
  };
  return new BackupOperationError(`BACKUP_REMOTE_${operation.toUpperCase()}_FAILED`, descriptions[operation], { cause: error });
}

function safeArtifactName(value: string): string {
  if (!/^ad-wiki-[A-Za-z0-9-]+$/.test(value)) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Der gespeicherte Artefaktname ist ungültig.");
  }
  return value;
}

async function copyArtifactAtomically(source: string, targetRoot: string, artifactName: string): Promise<string> {
  await mkdir(targetRoot, { recursive: true });
  const finalDirectory = path.join(targetRoot, artifactName);
  const partialDirectory = `${finalDirectory}.partial`;
  if (await localPathExists(finalDirectory)) {
    throw new BackupOperationError("BACKUP_ARTIFACT_EXISTS", "Das Backup-Artefakt existiert am Ziel bereits.");
  }
  await rm(partialDirectory, { recursive: true, force: true });
  await mkdir(partialDirectory, { recursive: false });
  try {
    for (const fileName of BACKUP_ARTIFACT_FILES) {
      await copyFile(path.join(source, fileName), path.join(partialDirectory, fileName));
    }
    await verifyBackupDirectory(partialDirectory, { allowPartial: true });
    await rename(partialDirectory, finalDirectory);
    return finalDirectory;
  } catch (error) {
    await rm(partialDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function prepareDownloadDirectory(targetRoot: string, artifactName: string): Promise<string> {
  await mkdir(targetRoot, { recursive: true });
  const finalDirectory = path.join(targetRoot, artifactName);
  if (await localPathExists(finalDirectory)) {
    throw new BackupOperationError("BACKUP_ARTIFACT_EXISTS", "Das Backup-Artefakt existiert im Restore-Ziel bereits.");
  }
  const partialDirectory = `${finalDirectory}.partial`;
  await rm(partialDirectory, { recursive: true, force: true });
  await mkdir(partialDirectory, { recursive: false });
  return finalDirectory;
}

async function finalizeDownloadedDirectory(finalDirectory: string): Promise<string> {
  if (await localPathExists(finalDirectory)) return finalDirectory;
  const partialDirectory = `${finalDirectory}.partial`;
  await verifyBackupDirectory(partialDirectory, { allowPartial: true });
  await rename(partialDirectory, finalDirectory);
  return finalDirectory;
}

async function localPathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function remoteJoin(...segments: string[]): string {
  const absolute = segments[0]?.startsWith("/") ?? false;
  const joined = path.posix.normalize(path.posix.join(...segments));
  if (!joined || joined === "." || joined.split("/").includes("..")) {
    throw new BackupOperationError("BACKUP_PATH_INVALID", "Der Remote-Pfad ist ungültig.");
  }
  return absolute && !joined.startsWith("/") ? `/${joined}` : joined;
}

function sameBuffer(expected: Buffer, actual: Buffer): boolean {
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function fingerprintMatches(expected: string, actualHex: string): boolean {
  const normalizedExpected = expected.startsWith("SHA256:")
    ? expected.slice("SHA256:".length).replace(/=+$/, "")
    : expected.toLowerCase();
  const normalizedActual = expected.startsWith("SHA256:")
    ? Buffer.from(actualHex, "hex").toString("base64").replace(/=+$/, "")
    : actualHex.toLowerCase();
  return sameBuffer(Buffer.from(normalizedExpected), Buffer.from(normalizedActual));
}

async function writeS3Body(body: unknown, target: string): Promise<void> {
  if (!(body instanceof Readable)) throw new Error("S3 response body is not a Node.js stream.");
  await pipeline(body, createWriteStream(target, { flags: "wx", mode: 0o640 }));
}

async function readSmallS3Body(body: unknown): Promise<Buffer> {
  if (!(body instanceof Readable)) throw new Error("S3 response body is not a Node.js stream.");
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const result = Buffer.concat(chunks);
  if (result.length > 4096) throw new Error("S3 test response is too large.");
  return result;
}

async function s3ObjectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "$metadata" in error
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
    if (status === 404) return false;
    throw error;
  }
}

function s3CopySource(bucket: string, key: string): string {
  return `/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function sshConnect(client: SshClient, config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      client.off("ready", onReady);
      client.off("error", onError);
    };
    client.once("ready", onReady);
    client.once("error", onError);
    client.connect(config);
  });
}

function sshSftp(client: SshClient): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

function sftpFastPut(sftp: SFTPWrapper, source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.fastPut(source, target, (error) => error ? reject(error) : resolve()));
}

function sftpFastGet(sftp: SFTPWrapper, source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.fastGet(source, target, (error) => error ? reject(error) : resolve()));
}

function sftpStat(sftp: SFTPWrapper, target: string): Promise<{ size: number }> {
  return new Promise((resolve, reject) => sftp.stat(target, (error, attributes) => error ? reject(error) : resolve(attributes)));
}

function sftpExists(sftp: SFTPWrapper, target: string): Promise<boolean> {
  return sftpStat(sftp, target).then(() => true, (error: { code?: string | number }) => {
    if (error.code === 2 || error.code === "ENOENT") return false;
    throw error;
  });
}

async function sftpMkdirRecursive(sftp: SFTPWrapper, target: string): Promise<void> {
  const absolute = target.startsWith("/");
  const segments = target.split("/").filter(Boolean);
  let current = absolute ? "/" : "";
  for (const segment of segments) {
    current = remoteJoin(current || segment, current ? segment : "");
    if (await sftpExists(sftp, current)) continue;
    await new Promise<void>((resolve, reject) => sftp.mkdir(current, (error) => error ? reject(error) : resolve()));
  }
}

function sftpRename(sftp: SFTPWrapper, source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => sftp.rename(source, target, (error) => error ? reject(error) : resolve()));
}

function sftpUnlink(sftp: SFTPWrapper, target: string, ignoreMissing: boolean): Promise<void> {
  return new Promise((resolve, reject) => sftp.unlink(target, (error) => {
    const code = (error as { code?: string | number } | undefined)?.code;
    if (!error || (ignoreMissing && (code === 2 || code === "ENOENT"))) resolve();
    else reject(error);
  }));
}

async function sftpRemoveArtifact(sftp: SFTPWrapper, directory: string, ignoreMissing: boolean): Promise<void> {
  if (!await sftpExists(sftp, directory)) {
    if (ignoreMissing) return;
    throw new BackupOperationError("BACKUP_ARTIFACT_MISSING", "Das Backup-Artefakt wurde am Ziel nicht gefunden.");
  }
  for (const fileName of BACKUP_ARTIFACT_FILES) {
    await sftpUnlink(sftp, remoteJoin(directory, fileName), ignoreMissing);
  }
  await new Promise<void>((resolve, reject) => sftp.rmdir(directory, (error) => error ? reject(error) : resolve()));
}

function sftpWriteFile(sftp: SFTPWrapper, target: string, content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => sftp.writeFile(target, content, (error) => error ? reject(error) : resolve()));
}

function sftpReadFile(sftp: SFTPWrapper, target: string): Promise<Buffer> {
  return new Promise((resolve, reject) => sftp.readFile(target, (error, content) => {
    if (error) reject(error);
    else resolve(Buffer.isBuffer(content) ? content : Buffer.from(content));
  }));
}
