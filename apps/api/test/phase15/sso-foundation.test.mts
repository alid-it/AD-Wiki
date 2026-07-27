import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConflictException } from "@nestjs/common";
import {
  CreateIdentityProviderSchema,
  IdentityProviderSchema,
  UpdateIdentityProviderSchema,
} from "@ad-wiki/shared-types";
import { GroupsService } from "../../dist/modules/groups/groups.service.js";
import type { AuthenticatedUser } from "../../dist/modules/auth/types/jwt-payload.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = resolve(TEST_DIRECTORY, "../..");
const PROVIDER_ID = "10000000-0000-4000-8000-000000000001";
const ROLE_ID = "20000000-0000-4000-8000-000000000002";
const GROUP_ID = "30000000-0000-4000-8000-000000000003";
const USER_ID = "40000000-0000-4000-8000-000000000004";
const MEMBERSHIP_ID = "50000000-0000-4000-8000-000000000005";
const NOW = "2026-07-24T00:00:00.000Z";

type GroupsPrisma = ConstructorParameters<typeof GroupsService>[0];
type PermissionDependency = ConstructorParameters<typeof GroupsService>[1];

const ACTOR: AuthenticatedUser = {
  id: USER_ID,
  email: "admin@example.test",
  username: "admin",
  displayName: "Administration",
  roleId: ROLE_ID,
  role: "admin",
  isActive: true,
  authenticationMethod: "jwt",
};

function membership(hasLocalGrant: boolean, externalGrantCount: number) {
  return {
    id: MEMBERSHIP_ID,
    groupId: GROUP_ID,
    userId: USER_ID,
    role: "MEMBER" as const,
    hasLocalGrant,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    _count: { externalGrants: externalGrantCount },
    user: {
      id: USER_ID,
      username: "ali",
      displayName: "Ali",
      isActive: true,
    },
  };
}

test("OIDC-Providerverträge sind strikt, providerneutral und sicher voreingestellt", () => {
  const provider = CreateIdentityProviderSchema.parse({
    name: "  Firmenlogin  ",
    issuer: "https://login.example.test/realms/ad-wiki",
    clientId: "ad-wiki",
    defaultRoleId: ROLE_ID,
  });

  assert.equal(provider.name, "Firmenlogin");
  assert.equal(provider.type, "GENERIC_OIDC");
  assert.deepEqual(provider.scopes, ["openid", "profile", "email"]);
  assert.equal(provider.groupSyncMode, "ADD_ONLY");
  assert.equal(provider.isActive, false);
  assert.equal(provider.allowJitProvisioning, false);
  assert.equal(provider.allowAdminRoleMapping, false);
  assert.equal(provider.maxSessionAgeMinutes, 480);
  assert.equal(provider.claimMapping.subject, "sub");

  assert.equal(
    CreateIdentityProviderSchema.safeParse({
      name: "Unsicher",
      issuer: "https://login.example.test",
      clientId: "ad-wiki",
      scopes: ["profile"],
    }).success,
    false,
  );
  assert.equal(
    CreateIdentityProviderSchema.safeParse({
      name: "Zu viele Felder",
      issuer: "https://login.example.test",
      clientId: "ad-wiki",
      encryptedClientSecret: "darf nie akzeptiert werden",
    }).success,
    false,
  );
});

test("Client-Secrets können nie über den sicheren Providervertrag ausgegeben werden", () => {
  const publicProvider = {
    id: PROVIDER_ID,
    slug: "firmenlogin",
    name: "Firmenlogin",
    type: "KEYCLOAK",
    issuer: "https://login.example.test/realms/ad-wiki",
    discoveryUrl: null,
    clientId: "ad-wiki",
    clientAuthMethod: "CLIENT_SECRET_POST",
    clientSecretConfigured: true,
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
    allowJitProvisioning: false,
    defaultRoleId: ROLE_ID,
    groupSyncMode: "MANAGED",
    groupClaim: "groups",
    roleClaim: null,
    allowAdminRoleMapping: false,
    maxSessionAgeMinutes: 480,
    entraGraphFallbackEnabled: false,
    entraGraphMembershipMode: "TRANSITIVE",
    entraGraphCacheTtlMinutes: 15,
    createdAt: NOW,
    updatedAt: NOW,
  };

  assert.equal(IdentityProviderSchema.safeParse(publicProvider).success, true);
  assert.equal(
    IdentityProviderSchema.safeParse({
      ...publicProvider,
      encryptedClientSecret: "verschlüsselt-aber-trotzdem-geheim",
    }).success,
    false,
  );
  assert.equal(
    UpdateIdentityProviderSchema.safeParse({
      clientSecret: "neu",
      clearClientSecret: true,
    }).success,
    false,
  );
});

test("Prisma modelliert Identitäten unveränderlich und Gruppen-Grants quellengetrennt", async () => {
  const schema = await readFile(
    resolve(API_DIRECTORY, "prisma/schema.prisma"),
    "utf8",
  );

  assert.match(schema, /model IdentityProvider \{/);
  assert.match(schema, /model ExternalIdentity \{/);
  assert.match(schema, /@@unique\(\[providerId, issuer, subject\]\)/);
  assert.match(schema, /@@unique\(\[providerId, userId\]\)/);
  assert.match(schema, /hasLocalGrant\s+Boolean/);
  assert.match(schema, /model ExternalGroupMembershipGrant \{/);
  assert.match(schema, /@@unique\(\[externalIdentityId, groupMappingId\]\)/);
  assert.match(schema, /@@unique\(\[providerId, priority\]\)/);
});

test("SSO-Grundlagen besitzen eine explizite Vorwärts- und Rückwärtsmigration", async () => {
  const migrationDirectory = resolve(
    API_DIRECTORY,
    "prisma/migrations/20260723232341_add_sso_foundation",
  );
  const migration = await readFile(
    resolve(migrationDirectory, "migration.sql"),
    "utf8",
  );
  const rollback = await readFile(
    resolve(migrationDirectory, "rollback.sql"),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "identity_providers"/);
  assert.match(migration, /CREATE TABLE "external_identities"/);
  assert.match(migration, /ADD COLUMN\s+"has_local_grant"/);
  assert.match(rollback, /DROP TABLE IF EXISTS "identity_providers"/);
  assert.match(rollback, /DROP COLUMN IF EXISTS "has_local_grant"/);
  assert.match(rollback, /DROP TYPE IF EXISTS "IdentityProviderType"/);
});

test("lokales Entfernen erhält eine weiterhin extern begründete Mitgliedschaft", async () => {
  let updatedData: unknown;
  let deleted = false;
  const service = new GroupsService(
    {
      group: {
        findUnique: async () => ({ id: GROUP_ID }),
      },
      groupMembership: {
        findUnique: async () => membership(true, 1),
        update: async (input: { data: unknown }) => {
          updatedData = input.data;
          return membership(false, 1);
        },
        delete: async () => {
          deleted = true;
          return membership(false, 0);
        },
      },
    } as unknown as GroupsPrisma,
    { isAllowed: async () => true } as unknown as PermissionDependency,
  );

  await service.removeMember(GROUP_ID, USER_ID, ACTOR);

  assert.deepEqual(updatedData, {
    hasLocalGrant: false,
    role: "MEMBER",
  });
  assert.equal(deleted, false);
});

test("eine ausschließlich externe Mitgliedschaft kann lokal nicht gelöscht werden", async () => {
  let mutated = false;
  const service = new GroupsService(
    {
      group: {
        findUnique: async () => ({ id: GROUP_ID }),
      },
      groupMembership: {
        findUnique: async () => membership(false, 1),
        update: async () => {
          mutated = true;
        },
        delete: async () => {
          mutated = true;
        },
      },
    } as unknown as GroupsPrisma,
    { isAllowed: async () => true } as unknown as PermissionDependency,
  );

  await assert.rejects(
    service.removeMember(GROUP_ID, USER_ID, ACTOR),
    ConflictException,
  );
  assert.equal(mutated, false);
});
