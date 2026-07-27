import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AclsService } from "../../dist/modules/acls/acls.service.js";
import { AuthService } from "../../dist/modules/auth/auth.service.js";
import { UsersService } from "../../dist/modules/users/users.service.js";

type UsersPrisma = ConstructorParameters<typeof UsersService>[0];
type AclsPrisma = ConstructorParameters<typeof AclsService>[0];
type AuthPrisma = ConstructorParameters<typeof AuthService>[0];
type SettingsDependency = ConstructorParameters<typeof AuthService>[2];
type AuditDependency = ConstructorParameters<typeof AuthService>[3];
type SmtpDependency = ConstructorParameters<typeof AuthService>[4];

test("das geschuetzte Setup-Konto blockiert administrative Benutzer- und Rechteaenderungen", async () => {
  const id = randomUUID();
  let writes = 0;
  const prisma = {
    user: {
      findUnique: async () => ({ id, isProtected: true }),
      update: async () => { writes += 1; },
    },
    role: { findUnique: async () => ({ id: randomUUID() }) },
    userPermission: {
      deleteMany: () => { writes += 1; },
      createMany: () => { writes += 1; },
    },
    $transaction: async () => { writes += 1; },
  };
  const users = new UsersService(prisma as unknown as UsersPrisma);
  const acls = new AclsService(prisma as unknown as AclsPrisma);

  await assert.rejects(
    users.assignRole(id, { roleId: randomUUID() }, randomUUID()),
    ForbiddenException,
  );
  await assert.rejects(users.deactivate(id), ForbiddenException);
  await assert.rejects(acls.setUserPermissions(id, [], randomUUID()), ForbiddenException);
  assert.equal(writes, 0);
});

test("das Passwort des Setup-Kontos kann nicht ueber Admin-Endpunkte ersetzt werden", async () => {
  const id = randomUUID();
  let smtpCalls = 0;
  let writes = 0;
  const prisma = {
    user: {
      findUnique: async () => ({
        id,
        email: "setup-admin@example.test",
        displayName: "Setup Admin",
        isActive: true,
        isProtected: true,
      }),
      update: () => { writes += 1; },
    },
    session: { deleteMany: () => { writes += 1; } },
    passwordResetToken: { updateMany: () => { writes += 1; } },
    $transaction: async () => { writes += 1; },
  } as unknown as AuthPrisma;
  const smtp = {
    sendPasswordReset: async () => { smtpCalls += 1; },
  } as unknown as SmtpDependency;
  const service = new AuthService(
    prisma,
    new JwtService({ secret: "test-secret-with-at-least-32-characters" }),
    {} as SettingsDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    smtp,
  );

  await assert.rejects(service.sendPasswordResetForUser(id), ForbiddenException);
  await assert.rejects(service.resetPasswordByAdmin(id, "neues-passwort"), ForbiddenException);
  assert.equal(smtpCalls, 0);
  assert.equal(writes, 0);
});

test("das Setup-Konto behaelt alle unterstuetzten effektiven Rechte", async () => {
  const service = new AuthService(
    {
      user: {
        findUnique: async () => ({
          isProtected: true,
          role: { acls: [] },
          permissions: [],
        }),
      },
    } as unknown as AuthPrisma,
    new JwtService({ secret: "test-secret-with-at-least-32-characters" }),
    {} as SettingsDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    {} as SmtpDependency,
  );

  const permissions = await service.getEffectivePermissions(randomUUID());
  assert.ok(permissions.length > 0);
  assert.ok(permissions.every((entry) => entry.allowed));
  assert.ok(permissions.some((entry) => entry.resource === "users" && entry.action === "update"));
  assert.ok(permissions.some((entry) => entry.resource === "backups" && entry.action === "restore"));
});
