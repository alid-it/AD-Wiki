import assert from "node:assert/strict";
import test from "node:test";
import { InternalServerErrorException } from "@nestjs/common";
import { BackupDestinationType as PrismaBackupDestinationType } from "@prisma/client";
import {
  CreateBackupDestinationSchema,
  CreateBackupPlanSchema,
  UpdateBackupDestinationSchema,
  isPermissionSupported,
  type BackupDestination,
  type CreateBackupDestinationInput,
} from "@ad-wiki/shared-types";
import { BackupEncryptionService } from "../../dist/modules/backups/backup-encryption.service.js";
import { BackupsController } from "../../dist/modules/backups/backups.controller.js";
import { BackupsService } from "../../dist/modules/backups/backups.service.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_ID = "20000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-07-22T06:00:00.000Z");

test("Backup-Verträge akzeptieren nur sichere Mounts und strukturierte Zeitpläne", () => {
  const local = CreateBackupDestinationSchema.parse({
    name: "Lokales Backup",
    settings: {
      type: "local",
      config: { mountName: "local", subdirectory: "daily/wiki" },
    },
  });
  assert.equal(local.isEnabled, true);
  assert.equal(local.settings.type, "local");

  assert.equal(CreateBackupDestinationSchema.safeParse({
    name: "Unsicher",
    settings: {
      type: "local",
      config: { mountName: "local", subdirectory: "../../host" },
    },
  }).success, false);
  assert.equal(CreateBackupDestinationSchema.safeParse({
    name: "Unbekannt",
    settings: { type: "ftp", config: {} },
  }).success, false);
  for (const removedType of ["smb", "nfs", "ftps"]) {
    assert.equal(CreateBackupDestinationSchema.safeParse({
      name: "Entfernter Zieltyp",
      settings: { type: removedType, config: { mountName: "network", subdirectory: "" } },
    }).success, false);
  }
  assert.equal(CreateBackupDestinationSchema.safeParse({
    name: "SFTP ohne Zugangsdaten",
    settings: {
      type: "sftp",
      config: {
        host: "backup.example.test",
        port: 22,
        username: "adwiki",
        basePath: "/backups",
        hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
      },
    },
  }).success, false);

  assert.equal(CreateBackupPlanSchema.safeParse({
    name: "Täglich",
    destinationId: DESTINATION_ID,
    schedule: { hour: 2, minute: 30, timezone: "Invalid/Timezone", weekdays: [1] },
    retention: { daily: 7, weekly: 4, monthly: 6 },
  }).success, false);
  const plan = CreateBackupPlanSchema.parse({
    name: "Täglich",
    destinationId: DESTINATION_ID,
    schedule: { hour: 2, minute: 30, timezone: "Europe/Berlin", weekdays: [7, 1, 1] },
    retention: { daily: 7, weekly: 4, monthly: 6 },
  });
  assert.deepEqual(plan.schedule.weekdays, [1, 7]);
  assert.equal(plan.enabled, false);
});

test("Backup-ACL trennt Verwaltung, Ausführung und Restore", () => {
  assert.equal(isPermissionSupported("backups", "read"), true);
  assert.equal(isPermissionSupported("backups", "run"), true);
  assert.equal(isPermissionSupported("backups", "restore"), true);
  assert.equal(isPermissionSupported("backups", "approve"), false);
  assert.equal(isPermissionSupported("pages", "restore"), false);
});

test("Backup-Verschlüsselung verwendet einen separaten authentifizierten Schlüssel", () => {
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  try {
    const encryption = new BackupEncryptionService();
    const first = encryption.encrypt("geheime-zugangsdaten");
    const second = encryption.encrypt("geheime-zugangsdaten");
    assert.notEqual(first, second);
    assert.equal(encryption.decrypt(first), "geheime-zugangsdaten");

    const segments = first.split(".");
    const tag = Buffer.from(segments[2], "base64url");
    tag[0] ^= 1;
    segments[2] = tag.toString("base64url");
    assert.throws(() => encryption.decrypt(segments.join(".")), InternalServerErrorException);
  } finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
  }
});

test("Backup-Zugangsdaten werden verschlüsselt gespeichert und aus Antworten entfernt", async () => {
  const previous = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
  let persisted: Record<string, unknown> | undefined;
  try {
    const encryption = new BackupEncryptionService();
    const service = new BackupsService({
      backupDestination: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          persisted = data;
          return {
            id: DESTINATION_ID,
            name: data.name,
            type: data.type,
            config: data.config,
            encryptedCredentials: data.encryptedCredentials,
            isEnabled: data.isEnabled,
            lastTestedAt: null,
            lastTestSucceeded: null,
            createdAt: NOW,
            updatedAt: NOW,
            createdById: USER_ID,
          };
        },
      },
    } as unknown as ConstructorParameters<typeof BackupsService>[0], encryption);

    const input = CreateBackupDestinationSchema.parse({
      name: "Offsite S3",
      settings: {
        type: "s3",
        config: {
          endpoint: "https://s3.example.test",
          region: "eu-central-1",
          bucket: "adwiki-backups",
          prefix: "production",
          forcePathStyle: false,
        },
        credentials: {
          accessKeyId: "access-id",
          secretAccessKey: "super-secret",
        },
      },
    });
    const result = await service.createDestination(USER_ID, input);
    assert.equal(persisted?.type, PrismaBackupDestinationType.S3);
    assert.equal(typeof persisted?.encryptedCredentials, "string");
    assert.equal(String(persisted?.encryptedCredentials).includes("super-secret"), false);
    assert.match(encryption.decrypt(String(persisted?.encryptedCredentials)), /super-secret/);
    assert.equal(result.hasCredentials, true);
    assert.equal(JSON.stringify(result).includes("super-secret"), false);
    assert.equal(JSON.stringify(result).includes("access-id"), false);
  } finally {
    if (previous === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previous;
  }
});

test("Backup-Audit enthält keine Zielzugangsdaten", async () => {
  const destination: BackupDestination = {
    id: DESTINATION_ID,
    name: "Offsite SFTP",
    type: "sftp",
    config: {
      host: "backup.example.test",
      port: 22,
      username: "adwiki",
      basePath: "/backups",
      hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
    },
    isEnabled: true,
    hasCredentials: true,
    lastTestedAt: null,
    lastTestSucceeded: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  let auditDetails: unknown;
  const controller = new BackupsController(
    { createDestination: async () => destination } as unknown as ConstructorParameters<typeof BackupsController>[0],
    {
      log: async (
        _userId: string,
        _action: string,
        _resource: string,
        _resourceId: string,
        details: unknown,
      ) => { auditDetails = details; },
    } as unknown as ConstructorParameters<typeof BackupsController>[1],
  );
  const input: CreateBackupDestinationInput = CreateBackupDestinationSchema.parse({
    name: "Offsite SFTP",
    settings: {
      type: "sftp",
      config: destination.config,
      credentials: { password: "niemals-protokollieren" },
    },
  });
  await controller.createDestination({ id: USER_ID } as never, "127.0.0.1", input);
  const serialized = JSON.stringify(auditDetails);
  assert.equal(serialized.includes("niemals-protokollieren"), false);
  assert.equal(serialized.includes("credentials"), false);
  assert.deepEqual(auditDetails, {
    name: "Offsite SFTP",
    type: "sftp",
    isEnabled: true,
  });
});

test("Remote-Zielwechsel ohne neue Zugangsdaten wird bereits im Service blockiert", async () => {
  const service = new BackupsService({
    backupDestination: {
      findUnique: async () => ({
        id: DESTINATION_ID,
        name: "Lokal",
        type: PrismaBackupDestinationType.LOCAL,
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
  } as unknown as ConstructorParameters<typeof BackupsService>[0], {} as ConstructorParameters<typeof BackupsService>[1]);
  const input = UpdateBackupDestinationSchema.parse({
    settings: {
      type: "sftp",
      config: {
        host: "backup.example.test",
        port: 22,
        username: "adwiki",
        basePath: "/backups",
        hostKeyFingerprint: `SHA256:${"A".repeat(43)}`,
      },
    },
  });
  await assert.rejects(() => service.updateDestination(DESTINATION_ID, input), /Zugangsdaten/);
});
