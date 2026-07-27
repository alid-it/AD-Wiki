import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { AuthService } from "../../dist/modules/auth/auth.service.js";

type AuthPrisma = ConstructorParameters<typeof AuthService>[0];
type SettingsDependency = ConstructorParameters<typeof AuthService>[2];
type AuditDependency = ConstructorParameters<typeof AuthService>[3];
type SmtpDependency = ConstructorParameters<typeof AuthService>[4];
type IdentitySyncDependency = NonNullable<
  ConstructorParameters<typeof AuthService>[7]
>;

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  externalIdentityId?: string | null;
  providerVerifiedAt?: Date | null;
  providerRecheckAfter?: Date | null;
}

const role = { id: randomUUID(), name: "viewer" };
const user = {
  id: randomUUID(),
  email: "rotation@example.com",
  username: "rotation-test",
  displayName: "Rotation Test",
  password: "",
  isActive: true,
  hasLocalPassword: true,
  role,
};

function createFixture(identitySync?: IdentitySyncDependency) {
  const sessions: SessionRow[] = [];
  const auditEvents: string[] = [];

  const sessionApi = {
    create: async ({ data }: { data: Omit<SessionRow, "createdAt" | "rotatedAt" | "revokedAt"> }) => {
      const row: SessionRow = {
        ...data,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        rotatedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      };
      sessions.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
      const row = sessions.find((entry) =>
        where.id !== undefined ? entry.id === where.id : entry.tokenHash === where.tokenHash,
      );
      return row
        ? {
            ...row,
            user,
            externalIdentity: row.externalIdentityId
              ? { provider: { isActive: true } }
              : null,
          }
        : null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id?: string;
        familyId?: string;
        rotatedAt?: null;
        revokedAt?: null;
        expiresAt?: { gt: Date };
      };
      data: { rotatedAt?: Date; revokedAt?: Date };
    }) => {
      const matches = sessions.filter((entry) =>
        (where.id === undefined || entry.id === where.id) &&
        (where.familyId === undefined || entry.familyId === where.familyId) &&
        (where.rotatedAt !== null || entry.rotatedAt === null) &&
        (where.revokedAt !== null || entry.revokedAt === null) &&
        (where.expiresAt === undefined || entry.expiresAt > where.expiresAt.gt),
      );
      matches.forEach((entry) => Object.assign(entry, data));
      return { count: matches.length };
    },
  };

  const prisma = {
    user: { findUnique: async () => user },
    session: sessionApi,
    $transaction: async <T,>(callback: (transaction: unknown) => Promise<T>) => callback(prisma),
  } as unknown as AuthPrisma;
  const jwt = new JwtService({ secret: "test-secret-with-at-least-32-characters" });
  const audit = {
    log: async (_userId: string, event: string) => {
      auditEvents.push(event);
    },
  } as unknown as AuditDependency;
  const service = new AuthService(
    prisma,
    jwt,
    { getValue: async () => "true" } as unknown as SettingsDependency,
    audit,
    {} as SmtpDependency,
    undefined,
    undefined,
    identitySync,
  );
  return { service, sessions, auditEvents, jwt };
}

test("Web-Refresh-Tokens werden nur gehasht gespeichert und bei Nutzung rotiert", async () => {
  user.password = await bcrypt.hash("sicheres-passwort", 4);
  const { service, sessions, jwt } = createFixture();

  const login = await service.login({
    email: user.email,
    password: "sicheres-passwort",
  });
  assert.equal(sessions.length, 1);
  assert.equal(
    sessions[0]?.tokenHash,
    createHash("sha256").update(login.refreshToken, "utf8").digest("hex"),
  );
  assert.equal(JSON.stringify(sessions).includes(login.refreshToken), false);

  const initialPayload = jwt.decode<{ tokenType?: string; tokenId?: string }>(login.refreshToken);
  assert.equal(initialPayload?.tokenType, "refresh");
  assert.equal(initialPayload?.tokenId, sessions[0]?.id);
  assert.equal(await service.verifyAccessToken(login.refreshToken), null);

  const rotated = await service.refreshToken(login.refreshToken);
  assert.notEqual(rotated.refreshToken, login.refreshToken);
  assert.equal(sessions.length, 2);
  assert.ok(sessions[0]?.rotatedAt);
  assert.ok(sessions[0]?.revokedAt);
  assert.equal(sessions[1]?.familyId, sessions[0]?.familyId);
  assert.equal(JSON.stringify(sessions).includes(rotated.refreshToken), false);
});

test("Wiederverwendung eines rotierten Tokens widerruft die gesamte Familie", async () => {
  user.password = await bcrypt.hash("sicheres-passwort", 4);
  const { service, sessions, auditEvents } = createFixture();
  const login = await service.login({ email: user.email, password: "sicheres-passwort" });
  const rotated = await service.refreshToken(login.refreshToken);

  await assert.rejects(service.refreshToken(login.refreshToken), UnauthorizedException);
  assert.ok(sessions.every((session) => session.revokedAt !== null));
  assert.deepEqual(auditEvents.filter((event) => event === "security.refresh_token_reuse"), [
    "security.refresh_token_reuse",
  ]);
  await assert.rejects(service.refreshToken(rotated.refreshToken), UnauthorizedException);
});

test("SSO-Sitzungen verlangen nach dem Provider-Prüfintervall eine neue Anmeldung", async () => {
  const identityId = randomUUID();
  const synchronizedIdentities: string[] = [];
  const { service, sessions } = createFixture({
    synchronizeStored: async (externalIdentityId: string) => {
      synchronizedIdentities.push(externalIdentityId);
    },
  } as unknown as IdentitySyncDependency);
  const login = await service.createSessionForUser(
    user.id,
    {},
    {
      externalIdentityId: identityId,
      verifiedAt: new Date(Date.now() - 60_000),
      recheckAfter: new Date(Date.now() + 60_000),
    },
  );
  assert.equal(sessions[0]?.externalIdentityId, identityId);
  assert.ok(sessions[0]?.providerVerifiedAt);
  assert.ok(await service.refreshToken(login.refreshToken));
  assert.deepEqual(synchronizedIdentities, [identityId]);

  const expiredFixture = createFixture();
  const expired = await expiredFixture.service.createSessionForUser(
    user.id,
    {},
    {
      externalIdentityId: identityId,
      verifiedAt: new Date(Date.now() - 120_000),
      recheckAfter: new Date(Date.now() - 60_000),
    },
  );
  await assert.rejects(
    expiredFixture.service.refreshToken(expired.refreshToken),
    UnauthorizedException,
  );
});
