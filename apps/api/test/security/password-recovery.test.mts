import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService } from "../../dist/modules/auth/auth.service.js";
import { SmtpCredentialEncryptionService } from "../../dist/modules/settings/smtp-credential-encryption.service.js";

type AuthPrisma = ConstructorParameters<typeof AuthService>[0];
type SettingsDependency = ConstructorParameters<typeof AuthService>[2];
type AuditDependency = ConstructorParameters<typeof AuthService>[3];
type SmtpDependency = ConstructorParameters<typeof AuthService>[4];

interface ResetRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

test("SMTP-Passwörter werden authentifiziert verschlüsselt und Manipulationen erkannt", () => {
  const previous = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const encryption = new SmtpCredentialEncryptionService();
    const encrypted = encryption.encrypt("smtp-geheimnis");
    assert.notEqual(encrypted, "smtp-geheimnis");
    assert.equal(encrypted.includes("smtp-geheimnis"), false);
    assert.equal(encryption.decrypt(encrypted), "smtp-geheimnis");
    const parts = encrypted.split(".");
    const cipherText = Buffer.from(parts[3] ?? "", "base64url");
    cipherText[0] = (cipherText[0] ?? 0) ^ 1;
    parts[3] = cipherText.toString("base64url");
    const tampered = parts.join(".");
    assert.throws(() => encryption.decrypt(tampered));
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previous;
  }
});

test("Reset-Links speichern nur den Hash, sind einmalig und widerrufen Sitzungen", async () => {
  const previousWebUrl = process.env.WEB_URL;
  process.env.WEB_URL = "https://wiki.example.test";
  const user = {
    id: randomUUID(),
    email: "reset@example.test",
    displayName: "Reset Test",
    isActive: true,
    password: await bcrypt.hash("altes-passwort", 4),
  };
  const rows: ResetRow[] = [];
  let sessionsDeleted = 0;
  let sentUrl = "";

  const resetApi = {
    updateMany: async ({ where, data }: { where: { id?: string; userId?: string; usedAt?: null; expiresAt?: { gt: Date } }; data: { usedAt: Date } }) => {
      const matches = rows.filter((row) =>
        (where.id === undefined || row.id === where.id) &&
        (where.userId === undefined || row.userId === where.userId) &&
        (where.usedAt !== null || row.usedAt === null) &&
        (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt),
      );
      matches.forEach((row) => { row.usedAt = data.usedAt; });
      return { count: matches.length };
    },
    create: async ({ data }: { data: Omit<ResetRow, "id" | "usedAt"> }) => {
      const row = { ...data, id: randomUUID(), usedAt: null };
      rows.push(row);
      return { id: row.id };
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) => {
      const row = rows.find((entry) => entry.tokenHash === where.tokenHash);
      return row ? { ...row, user: { id: user.id, isActive: user.isActive } } : null;
    },
  };
  const prisma = {
    user: {
      findUnique: async () => user,
      update: async ({ data }: { data: { password: string } }) => {
        user.password = data.password;
        return user;
      },
    },
    session: { deleteMany: async () => { sessionsDeleted += 1; return { count: 1 }; } },
    passwordResetToken: resetApi,
    $transaction: async <T,>(callback: (transaction: unknown) => Promise<T>) => callback(prisma),
  } as unknown as AuthPrisma;
  const smtp = {
    sendPasswordReset: async ({ resetUrl }: { resetUrl: string }) => { sentUrl = resetUrl; },
  } as unknown as SmtpDependency;
  const audit = { log: async () => undefined } as unknown as AuditDependency;
  const service = new AuthService(
    prisma,
    new JwtService({ secret: "test-secret-with-at-least-32-characters" }),
    {} as SettingsDependency,
    audit,
    smtp,
  );

  try {
    await service.sendPasswordResetForUser(user.id);
    const token = new URL(sentUrl).searchParams.get("token");
    assert.ok(token);
    assert.equal(JSON.stringify(rows).includes(token), false);
    assert.equal(rows[0]?.tokenHash, createHash("sha256").update(token, "utf8").digest("hex"));

    await service.resetPassword(token, "neues-passwort");
    assert.equal(await bcrypt.compare("neues-passwort", user.password), true);
    assert.equal(sessionsDeleted, 1);
    assert.ok(rows[0]?.usedAt);
    await assert.rejects(service.resetPassword(token, "noch-ein-passwort"), BadRequestException);
  } finally {
    if (previousWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = previousWebUrl;
  }
});
