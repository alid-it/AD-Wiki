import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  IdentitySyncError,
  IdentitySynchronizationService,
} from "../../dist/modules/auth/oidc/identity-synchronization.service.js";
import { EffectiveRoleService } from "../../dist/modules/auth/effective-role.service.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = resolve(TEST_DIRECTORY, "../..");
const PROVIDER_ID = "10000000-0000-4000-8000-000000000001";
const IDENTITY_ID = "20000000-0000-4000-8000-000000000002";
const USER_ID = "30000000-0000-4000-8000-000000000003";
const IT_GROUP_ID = "40000000-0000-4000-8000-000000000004";
const OLD_GROUP_ID = "50000000-0000-4000-8000-000000000005";
const IT_MAPPING_ID = "60000000-0000-4000-8000-000000000006";
const OLD_MAPPING_ID = "70000000-0000-4000-8000-000000000007";
const EDITOR_ROLE_ID = "80000000-0000-4000-8000-000000000008";
const VIEWER_ROLE_ID = "90000000-0000-4000-8000-000000000009";
const ROLE_MAPPING_ID = "a0000000-0000-4000-8000-00000000000a";
const MEMBERSHIP_ID = "b0000000-0000-4000-8000-00000000000b";

type SyncPrisma = ConstructorParameters<typeof IdentitySynchronizationService>[0];
type SyncAudit = ConstructorParameters<typeof IdentitySynchronizationService>[1];
type SyncModuleRef = ConstructorParameters<typeof IdentitySynchronizationService>[2];
type EffectiveRolePrisma = ConstructorParameters<typeof EffectiveRoleService>[0];

const viewerRole = {
  id: VIEWER_ROLE_ID,
  name: "viewer",
  description: null,
  isSystem: true,
  createdAt: new Date(),
};
const editorRole = {
  id: EDITOR_ROLE_ID,
  name: "editor",
  description: null,
  isSystem: true,
  createdAt: new Date(),
  acls: [{ resource: "pages" }],
};

function groupMapping(
  id: string,
  externalValue: string,
  groupId: string,
  groupName: string,
) {
  return {
    id,
    providerId: PROVIDER_ID,
    externalGroupId: externalValue,
    externalGroupPath: externalValue.startsWith("/") ? externalValue : null,
    externalGroupName: groupName,
    groupId,
    group: {
      id: groupId,
      name: groupName,
      slug: groupName.toLowerCase(),
      description: null,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function roleMapping(priority = 10) {
  return {
    id: ROLE_MAPPING_ID,
    providerId: PROVIDER_ID,
    source: "ROLE",
    externalValue: "editor",
    roleId: EDITOR_ROLE_ID,
    role: editorRole,
    priority,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function identity(mode: "ADD_ONLY" | "MANAGED" = "MANAGED") {
  const oldMapping = groupMapping(
    OLD_MAPPING_ID,
    "/legacy",
    OLD_GROUP_ID,
    "Legacy",
  );
  return {
    id: IDENTITY_ID,
    issuer: "https://login.example.test/realms/wiki",
    subject: "subject-1",
    email: "ali@example.test",
    username: "ali",
    displayName: "Ali",
    lastLoginAt: new Date(),
    lastGroupSyncAt: null,
    lastSyncErrorCode: null,
    lastGroupClaims: [],
    lastRoleClaims: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    providerId: PROVIDER_ID,
    userId: USER_ID,
    provider: {
      id: PROVIDER_ID,
      name: "Firmenlogin",
      slug: "firmenlogin",
      type: "KEYCLOAK",
      issuer: "https://login.example.test/realms/wiki",
      discoveryUrl: null,
      clientId: "ad-wiki",
      clientAuthMethod: "NONE",
      encryptedClientSecret: null,
      scopes: ["openid"],
      claimMapping: {},
      isActive: true,
      displayOrder: 0,
      allowJitProvisioning: false,
      defaultRoleId: null,
      groupSyncMode: mode,
      groupClaim: "groups",
      roleClaim: "realm_access.roles",
      allowAdminRoleMapping: false,
      maxSessionAgeMinutes: 480,
      createdAt: new Date(),
      updatedAt: new Date(),
      groupMappings: [
        groupMapping(IT_MAPPING_ID, "/it", IT_GROUP_ID, "IT"),
        oldMapping,
      ],
      roleMappings: [roleMapping()],
    },
    user: {
      id: USER_ID,
      externalIdentities: [
        { id: IDENTITY_ID, externalRoleGrant: null },
      ],
    },
    groupMembershipGrants: [
      {
        id: "c0000000-0000-4000-8000-00000000000c",
        externalIdentityId: IDENTITY_ID,
        groupMappingId: OLD_MAPPING_ID,
        membershipId: MEMBERSHIP_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
        membership: {
          id: MEMBERSHIP_ID,
          groupId: OLD_GROUP_ID,
          userId: USER_ID,
          role: "MANAGER",
          hasLocalGrant: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        groupMapping: oldMapping,
      },
    ],
    externalRoleGrant: null,
  };
}

function previewService(previewIdentity = identity()) {
  return new IdentitySynchronizationService(
    {
      externalIdentity: {
        findFirst: async () => previewIdentity,
      },
    } as unknown as SyncPrisma,
    { log: async () => undefined } as unknown as SyncAudit,
  );
}

test("Dry-Run normalisiert Strings und verschachtelte Arrays ohne Schreibzugriff", async () => {
  const preview = await previewService().preview(
    PROVIDER_ID,
    IDENTITY_ID,
    {
      groups: "/it",
      realm_access: { roles: ["unknown", "editor", "editor"] },
    },
  );

  assert.deepEqual(preview.normalizedClaims, {
    groups: ["/it"],
    roles: ["editor", "unknown"],
  });
  assert.deepEqual(
    preview.groups.add.map((change) => change.groupId),
    [IT_GROUP_ID],
  );
  assert.deepEqual(
    preview.groups.remove.map((change) => change.groupId),
    [OLD_GROUP_ID],
  );
  assert.equal(preview.role.next?.roleId, EDITOR_ROLE_ID);
  assert.equal(preview.role.changed, true);
  assert.deepEqual(preview.role.ignoredValues.sort(), ["/it", "unknown"]);

  const unknown = await previewService().preview(
    PROVIDER_ID,
    IDENTITY_ID,
    { groups: ["/unknown"], realm_access: { roles: [] } },
  );
  assert.deepEqual(unknown.groups.add, []);
  assert.deepEqual(unknown.groups.ignoredValues, ["/unknown"]);
});

test("ADD_ONLY erhält alte Provider-Grants, MANAGED entfernt ausschließlich eigene Grants", async () => {
  const addOnlyPreview = await previewService(identity("ADD_ONLY")).preview(
    PROVIDER_ID,
    IDENTITY_ID,
    { groups: ["/it"], realm_access: { roles: [] } },
  );
  assert.deepEqual(addOnlyPreview.groups.remove, []);
  assert.ok(
    addOnlyPreview.groups.keep.some(
      (change) => change.groupId === OLD_GROUP_ID,
    ),
  );

  const managedIdentity = identity("MANAGED");
  const createdGrants: Array<Record<string, unknown>> = [];
  const deletedGrantFilters: Array<Record<string, unknown>> = [];
  const membershipCleanup: Array<Record<string, unknown>> = [];
  const identityUpdates: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];
  const socketSignals: string[] = [];
  let transactionCount = 0;
  const prisma = {
    externalIdentity: {
      findUnique: async () => managedIdentity,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        identityUpdates.push(data);
      },
      updateMany: async () => ({ count: 1 }),
    },
    groupMembership: {
      findUnique: async () => null,
      create: async () => ({ id: "d0000000-0000-4000-8000-00000000000d" }),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        membershipCleanup.push(where);
        return { count: 0 };
      },
    },
    externalGroupMembershipGrant: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdGrants.push(data);
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        deletedGrantFilters.push(where);
        return { count: 1 };
      },
    },
    externalRoleGrant: {
      upsert: async () => undefined,
      deleteMany: async () => ({ count: 0 }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
      },
    },
    $transaction: async <T,>(
      callback: (transaction: unknown) => Promise<T>,
    ) => {
      transactionCount += 1;
      return callback(prisma);
    },
  };
  const service = new IdentitySynchronizationService(
    prisma as unknown as SyncPrisma,
    { log: async () => undefined } as unknown as SyncAudit,
    {
      get: () => ({
        notifyPermissionsUpdated: () => socketSignals.push("permissions"),
      }),
    } as unknown as SyncModuleRef,
  );

  const result = await service.synchronize(
    IDENTITY_ID,
    { groups: ["/it"], realm_access: { roles: ["editor"] } },
    { ipAddress: "127.0.0.1" },
  );

  assert.equal(transactionCount, 1);
  assert.equal(createdGrants[0]?.externalIdentityId, IDENTITY_ID);
  assert.equal(createdGrants[0]?.groupMappingId, IT_MAPPING_ID);
  assert.equal(deletedGrantFilters[0]?.externalIdentityId, IDENTITY_ID);
  assert.deepEqual(membershipCleanup[0]?.hasLocalGrant, false);
  assert.deepEqual(membershipCleanup[0]?.externalGrants, { none: {} });
  assert.deepEqual(identityUpdates[0]?.lastGroupClaims, ["/it"]);
  assert.deepEqual(identityUpdates[0]?.lastRoleClaims, ["editor"]);
  assert.equal(auditRows[0]?.action, "identity.groups_synced");
  assert.deepEqual(socketSignals, ["permissions"]);
  assert.equal(result.role.next?.roleId, EDITOR_ROLE_ID);
});

test("mehrdeutige Gruppen, Prioritätsgleichstände und Admin-Rollen werden abgewiesen", async () => {
  const ambiguous = identity();
  ambiguous.provider.groupMappings.push(
    groupMapping(
      "e0000000-0000-4000-8000-00000000000e",
      "/it",
      "f0000000-0000-4000-8000-00000000000f",
      "IT Doppel",
    ),
  );
  await assert.rejects(
    previewService(ambiguous).preview(PROVIDER_ID, IDENTITY_ID, {
      groups: ["/it"],
      realm_access: { roles: [] },
    }),
    (error: unknown) =>
      error instanceof IdentitySyncError &&
      error.code === "group_mapping_ambiguous",
  );

  const tied = identity();
  tied.provider.roleMappings.push({
    ...roleMapping(),
    id: "11000000-0000-4000-8000-000000000011",
    externalValue: "editor-two",
  });
  await assert.rejects(
    previewService(tied).preview(PROVIDER_ID, IDENTITY_ID, {
      groups: [],
      realm_access: { roles: ["editor", "editor-two"] },
    }),
    (error: unknown) =>
      error instanceof IdentitySyncError &&
      error.code === "role_priority_conflict",
  );

  const admin = identity();
  admin.provider.roleMappings[0] = {
    ...roleMapping(),
    role: {
      ...editorRole,
      id: "12000000-0000-4000-8000-000000000012",
      name: "admin",
      acls: [{ resource: "users" }],
    },
  };
  await assert.rejects(
    previewService(admin).preview(PROVIDER_ID, IDENTITY_ID, {
      groups: [],
      realm_access: { roles: ["editor"] },
    }),
    (error: unknown) =>
      error instanceof IdentitySyncError &&
      error.code === "admin_role_mapping_disabled",
  );
});

test("fehlerhafte Claims ändern keine Grants und werden am Konto auditiert", async () => {
  const syncIdentity = identity();
  const errorCodes: string[] = [];
  const audits: Array<{ action: string; details: unknown }> = [];
  let transactionStarted = false;
  const service = new IdentitySynchronizationService(
    {
      externalIdentity: {
        findUnique: async () => syncIdentity,
        updateMany: async ({ data }: { data: { lastSyncErrorCode: string } }) => {
          errorCodes.push(data.lastSyncErrorCode);
          return { count: 1 };
        },
      },
      $transaction: async () => {
        transactionStarted = true;
      },
    } as unknown as SyncPrisma,
    {
      log: async (
        _userId: string,
        action: string,
        _resource: string,
        _resourceId: string,
        details: unknown,
      ) => {
        audits.push({ action, details });
      },
    } as unknown as SyncAudit,
  );

  await assert.rejects(
    service.synchronize(IDENTITY_ID, {
      groups: ["/it"],
      realm_access: { roles: { unexpected: true } },
    }),
    (error: unknown) =>
      error instanceof IdentitySyncError &&
      error.code === "role_claim_invalid",
  );
  assert.equal(transactionStarted, false);
  assert.deepEqual(errorCodes, ["role_claim_invalid"]);
  assert.equal(audits[0]?.action, "identity.sync_failed");
});

test("externe Rollen wirken priorisiert, ohne die lokale Benutzerrolle zu überschreiben", async () => {
  const service = new EffectiveRoleService({
    user: {
      findUnique: async () => ({
        id: USER_ID,
        email: "ali@example.test",
        username: "ali",
        displayName: "Ali",
        roleId: VIEWER_ROLE_ID,
        isActive: true,
        isProtected: false,
        hasLocalPassword: true,
        role: viewerRole,
        externalIdentities: [
          {
            externalRoleGrant: {
              role: {
                ...editorRole,
                acls: undefined,
              },
              roleMapping: {
                id: ROLE_MAPPING_ID,
                priority: 10,
                providerId: PROVIDER_ID,
                provider: { displayOrder: 0 },
              },
            },
          },
        ],
      }),
    },
  } as unknown as EffectiveRolePrisma);

  const effective = await service.resolveUser(USER_ID);
  assert.equal(effective?.roleId, EDITOR_ROLE_ID);
  assert.equal(effective?.role.name, "editor");
  assert.equal(effective?.id, USER_ID);
});

test("Phase 15D besitzt eine reversible Prisma-Migration", async () => {
  const migrationDirectory = resolve(
    API_DIRECTORY,
    "prisma/migrations/20260724165608_add_oidc_group_role_sync",
  );
  const [migration, rollback] = await Promise.all([
    readFile(resolve(migrationDirectory, "migration.sql"), "utf8"),
    readFile(resolve(migrationDirectory, "rollback.sql"), "utf8"),
  ]);

  assert.match(migration, /CREATE TABLE "external_role_grants"/);
  assert.match(migration, /"last_group_claims"/);
  assert.match(rollback, /DROP TABLE IF EXISTS "external_role_grants"/);
  assert.match(rollback, /DROP COLUMN IF EXISTS "last_group_claims"/);
});
