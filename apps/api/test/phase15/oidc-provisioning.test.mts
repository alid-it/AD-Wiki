import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConflictException } from "@nestjs/common";
import {
  OidcLoginError,
  OidcService,
} from "../../dist/modules/auth/oidc/oidc.service.js";
import { isSafeJitDefaultRole } from "../../dist/modules/auth/oidc/oidc-jit-policy.js";

const PROVIDER_ID = "10000000-0000-4000-8000-000000000001";
const ROLE_ID = "20000000-0000-4000-8000-000000000002";
const USER_ID = "30000000-0000-4000-8000-000000000003";
const IDENTITY_ID = "40000000-0000-4000-8000-000000000004";
const ISSUER = "https://login.example.test/realms/ad-wiki";
const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = resolve(TEST_DIRECTORY, "../..");

type OidcPrisma = ConstructorParameters<typeof OidcService>[0];
type OidcAuth = ConstructorParameters<typeof OidcService>[1];
type OidcEncryption = ConstructorParameters<typeof OidcService>[2];
type OidcAudit = ConstructorParameters<typeof OidcService>[3];

const provider = {
  id: PROVIDER_ID,
  name: "Firmenlogin",
  slug: "firmenlogin",
  type: "KEYCLOAK",
  issuer: ISSUER,
  clientId: "ad-wiki",
  clientAuthMethod: "NONE",
  encryptedClientSecret: null,
  scopes: ["openid", "profile", "email"],
  claimMapping: {
    subject: "sub",
    email: "email",
    emailVerified: "email_verified",
    username: "preferred_username",
    displayName: "name",
  },
  isActive: true,
  displayOrder: 0,
  allowJitProvisioning: true,
  defaultRoleId: ROLE_ID,
  maxSessionAgeMinutes: 480,
};

const profile = {
  subject: "external-subject",
  email: "new.user@example.test",
  username: "New User",
  displayName: "New User",
};

interface InternalOidcService {
  provisionIdentity(
    configuredProvider: unknown,
    issuer: string,
    mappedProfile: typeof profile,
    context: { ipAddress?: string },
  ): Promise<{
    id: string;
    user: { id: string; isActive: boolean; isProtected: boolean };
  }>;
  linkIdentity(
    configuredProvider: unknown,
    userId: string,
    issuer: string,
    mappedProfile: typeof profile,
    context: { ipAddress?: string },
  ): Promise<void>;
  unlinkIdentity(
    providerId: string,
    userId: string,
    identityId: string,
    issuer: string,
    subject: string,
    context: { ipAddress?: string },
  ): Promise<void>;
}

function serviceWith(prisma: object, audits: string[] = []) {
  const service = new OidcService(
    prisma as OidcPrisma,
    {} as OidcAuth,
    { isConfigured: () => true } as unknown as OidcEncryption,
    {
      log: async (
        _userId: string | null,
        action: string,
      ) => {
        audits.push(action);
      },
    } as unknown as OidcAudit,
  );
  return service as unknown as InternalOidcService;
}

test("JIT akzeptiert ausschließlich nicht-administrative Standardrollen", () => {
  assert.equal(
    isSafeJitDefaultRole({
      name: "viewer",
      acls: [{ resource: "pages" }],
    }),
    true,
  );
  assert.equal(
    isSafeJitDefaultRole({
      name: "admin",
      acls: [{ resource: "pages" }],
    }),
    false,
  );
  assert.equal(
    isSafeJitDefaultRole({
      name: "editor",
      acls: [{ resource: "settings" }],
    }),
    false,
  );
  assert.equal(isSafeJitDefaultRole(null), false);
});

test("JIT legt nur mit sicherer Standardrolle ein neues, extern gebundenes Konto an", async () => {
  let createdUser: Record<string, unknown> | undefined;
  let createdIdentity: Record<string, unknown> | undefined;
  const audits: string[] = [];
  const prisma = {
    role: {
      findUnique: async () => ({
        id: ROLE_ID,
        name: "viewer",
        acls: [{ resource: "pages" }],
      }),
    },
    user: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdUser = data;
        return { id: USER_ID, isActive: true, isProtected: false };
      },
    },
    externalIdentity: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdIdentity = data;
        return { id: IDENTITY_ID };
      },
    },
    $transaction: async <T,>(
      callback: (transaction: unknown) => Promise<T>,
    ) => callback(prisma),
  };

  const identity = await serviceWith(prisma, audits).provisionIdentity(
    provider,
    ISSUER,
    profile,
    { ipAddress: "127.0.0.1" },
  );

  assert.equal(identity.id, IDENTITY_ID);
  assert.equal(createdUser?.email, "new.user@example.test");
  assert.equal(createdUser?.username, "new-user");
  assert.equal(createdUser?.hasLocalPassword, false);
  assert.equal(createdUser?.roleId, ROLE_ID);
  assert.equal(typeof createdUser?.password, "string");
  assert.notEqual(createdUser?.password, profile.subject);
  assert.equal(createdIdentity?.subject, profile.subject);
  assert.deepEqual(audits, ["user.jit_provisioned", "identity.linked"]);
});

test("JIT übernimmt weder bestehende E-Mail-Konten noch administrative Standardrollen", async () => {
  const emailConflictPrisma = {
    role: {
      findUnique: async () => ({
        id: ROLE_ID,
        name: "viewer",
        acls: [{ resource: "pages" }],
      }),
    },
    user: {
      findFirst: async () => ({ id: USER_ID }),
    },
    $transaction: async <T,>(
      callback: (transaction: unknown) => Promise<T>,
    ) => callback(emailConflictPrisma),
  };
  await assert.rejects(
    serviceWith(emailConflictPrisma).provisionIdentity(
      provider,
      ISSUER,
      profile,
      {},
    ),
    (error: unknown) =>
      error instanceof OidcLoginError &&
      error.code === "account_conflict",
  );

  const unsafeRolePrisma = {
    role: {
      findUnique: async () => ({
        id: ROLE_ID,
        name: "admin",
        acls: [{ resource: "users" }],
      }),
    },
  };
  await assert.rejects(
    serviceWith(unsafeRolePrisma).provisionIdentity(
      provider,
      ISSUER,
      profile,
      {},
    ),
    (error: unknown) =>
      error instanceof OidcLoginError &&
      error.code === "jit_unavailable",
  );
});

test("Kontoverknüpfung lehnt eine bereits fremd belegte externe Identität ab", async () => {
  const prisma = {
    user: {
      findUnique: async () => ({ isActive: true, isProtected: false }),
    },
    externalIdentity: {
      findUnique: async () => ({
        id: IDENTITY_ID,
        userId: "50000000-0000-4000-8000-000000000005",
      }),
    },
    $transaction: async <T,>(
      callback: (transaction: unknown) => Promise<T>,
    ) => callback(prisma),
  };

  await assert.rejects(
    serviceWith(prisma).linkIdentity(
      provider,
      USER_ID,
      ISSUER,
      profile,
      {},
    ),
    (error: unknown) =>
      error instanceof OidcLoginError &&
      error.code === "account_conflict",
  );
});

test("letzte SSO-Anmeldemethode eines Kontos ohne lokales Passwort bleibt geschützt", async () => {
  const service = new OidcService(
    {
      externalIdentity: {
        findFirst: async () => ({
          id: IDENTITY_ID,
          provider: { slug: provider.slug, isActive: true },
          user: {
            isActive: true,
            isProtected: false,
            hasLocalPassword: false,
            _count: { externalIdentities: 1 },
          },
        }),
      },
    } as unknown as OidcPrisma,
    {} as OidcAuth,
    { isConfigured: () => true } as unknown as OidcEncryption,
    { log: async () => undefined } as unknown as OidcAudit,
  );

  await assert.rejects(
    service.startUnlink(IDENTITY_ID, USER_ID),
    ConflictException,
  );
});

test("kontrolliertes Entfernen widerruft gebundene Sitzungen vor der Identität", async () => {
  const order: string[] = [];
  const audits: string[] = [];
  const prisma = {
    externalIdentity: {
      findFirst: async () => ({
        id: IDENTITY_ID,
        userId: USER_ID,
        providerId: PROVIDER_ID,
        issuer: ISSUER,
        subject: profile.subject,
        user: {
          isProtected: false,
          hasLocalPassword: true,
          _count: { externalIdentities: 1 },
        },
      }),
      delete: async () => {
        order.push("identity");
      },
    },
    session: {
      updateMany: async () => {
        order.push("sessions");
        return { count: 2 };
      },
    },
    $transaction: async <T,>(
      callback: (transaction: unknown) => Promise<T>,
    ) => callback(prisma),
  };

  await serviceWith(prisma, audits).unlinkIdentity(
    PROVIDER_ID,
    USER_ID,
    IDENTITY_ID,
    ISSUER,
    profile.subject,
    {},
  );

  assert.deepEqual(order, ["sessions", "identity"]);
  assert.deepEqual(audits, ["identity.unlinked"]);
});

test("Phase 15C besitzt vorbereitende und reversible Prisma-Migrationen", async () => {
  const preparation = resolve(
    API_DIRECTORY,
    "prisma/migrations/20260724095800_prepare_oidc_jit_login_codes",
  );
  const migration = resolve(
    API_DIRECTORY,
    "prisma/migrations/20260724095820_add_oidc_jit_and_account_linking",
  );
  const [prepareSql, prepareRollback, migrationSql, rollbackSql] =
    await Promise.all([
      readFile(resolve(preparation, "migration.sql"), "utf8"),
      readFile(resolve(preparation, "rollback.sql"), "utf8"),
      readFile(resolve(migration, "migration.sql"), "utf8"),
      readFile(resolve(migration, "rollback.sql"), "utf8"),
    ]);

  assert.match(prepareSql, /DELETE FROM "oidc_login_codes"/);
  assert.match(prepareRollback, /SELECT 1/);
  assert.match(migrationSql, /CREATE TYPE "OidcAuthorizationIntent"/);
  assert.match(migrationSql, /"has_local_password"/);
  assert.match(migrationSql, /"provider_recheck_after"/);
  assert.match(rollbackSql, /DROP TYPE IF EXISTS "OidcAuthorizationIntent"/);
  assert.match(rollbackSql, /DROP COLUMN IF EXISTS "has_local_password"/);
});
