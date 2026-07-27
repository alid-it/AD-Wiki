import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import {
  AuditAction,
  AuditResource,
  CreateKnowledgeSpaceSchema,
  PERMISSION_CATALOG,
  UpdateKnowledgeSpaceSchema,
} from "@ad-wiki/shared-types";
import { SpacesController } from "../../dist/modules/spaces/spaces.controller.js";
import {
  DEFAULT_SPACE_ID,
  SpacesService,
} from "../../dist/modules/spaces/spaces.service.js";
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from "../../dist/modules/auth/decorators/require-permission.decorator.js";
import type { AuthenticatedUser } from "../../dist/modules/auth/types/jwt-payload.js";

const SPACE_ID = "10000000-0000-4000-8000-000000000014";
const NOW = new Date("2026-07-23T19:45:00.000Z");

type SpacesPrisma = ConstructorParameters<typeof SpacesService>[0];

function permissionsOf(
  controller: object,
  method: string,
): RequiredPermission[] {
  const target = Object.getPrototypeOf(controller) as Record<string, unknown>;
  const metadata = Reflect.getMetadata(
    PERMISSION_KEY,
    target[method] as object,
  ) as RequiredPermission | RequiredPermission[] | undefined;
  if (!metadata) return [];
  return Array.isArray(metadata) ? metadata : [metadata];
}

function space(isSystem = false, contentCount = 0) {
  return {
    id: SPACE_ID,
    name: "IT intern",
    slug: "it-intern",
    description: null,
    visibility: "OPEN" as const,
    enabledKinds: ["WIKI", "NOTE", "STANDARD"] as const,
    isSystem,
    responsibleGroupId: null,
    responsibleGroup: null,
    createdAt: NOW,
    updatedAt: NOW,
    _count: {
      categories: contentCount,
      pages: 0,
      notes: 0,
      standards: 0,
      resourceAclEntries: 0,
      aclBoundaries: 0,
    },
  };
}

test("Bereichsverträge, Auditwerte und Rechtekatalog sind typisiert", () => {
  const created = CreateKnowledgeSpaceSchema.parse({
    name: "  IT intern  ",
    enabledKinds: ["wiki", "standard"],
  });
  assert.equal(created.name, "IT intern");
  assert.equal(created.visibility, "open");
  assert.deepEqual(created.enabledKinds, ["wiki", "standard"]);
  assert.equal(
    CreateKnowledgeSpaceSchema.safeParse({
      name: "Leer",
      enabledKinds: [],
    }).success,
    false,
  );
  assert.equal(
    UpdateKnowledgeSpaceSchema.safeParse({
      visibility: "private",
    }).success,
    false,
  );
  assert.deepEqual(PERMISSION_CATALOG.spaces, [
    "create",
    "read",
    "update",
    "delete",
  ]);
  assert.equal(AuditResource.parse("space"), "space");
  assert.equal(AuditAction.parse("space.created"), "space.created");
});

test("Bereichsendpunkte verlangen getrennte globale Rechte", () => {
  const controller = Object.create(
    SpacesController.prototype,
  ) as SpacesController;
  assert.deepEqual(permissionsOf(controller, "findAll"), [
    { resource: "spaces", action: "read" },
  ]);
  assert.deepEqual(permissionsOf(controller, "create"), [
    { resource: "spaces", action: "create" },
  ]);
  assert.deepEqual(permissionsOf(controller, "update"), [
    { resource: "spaces", action: "update" },
  ]);
  assert.deepEqual(permissionsOf(controller, "remove"), [
    { resource: "spaces", action: "delete" },
  ]);
});

test("RESTRICTED wird mit vererbten Besitzerregeln sicher aktiviert", async () => {
  let ownerRules: Array<{ action: string; userId: string; spaceId: string }> = [];
  const restricted = { ...space(), visibility: "RESTRICTED" as const };
  const prisma = {
    knowledgeSpace: {
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => restricted,
    },
    resourceAclEntry: {
      createMany: async ({ data }: { data: typeof ownerRules }) => {
        ownerRules = data;
        return { count: data.length };
      },
    },
  };
  const transactionalPrisma = {
    ...prisma,
    $transaction: async <T,>(
      operation: (transaction: typeof prisma) => Promise<T>,
    ) => operation(prisma),
  };
  const service = new SpacesService(
    transactionalPrisma as unknown as SpacesPrisma,
  );
  const actor: AuthenticatedUser = {
    id: "20000000-0000-4000-8000-000000000014",
    email: "admin@example.test",
    username: "admin",
    displayName: "Admin",
    roleId: "30000000-0000-4000-8000-000000000014",
    role: "admin",
    isActive: true,
    authenticationMethod: "jwt",
  };
  const created = await service.create({
      name: "Personal",
      visibility: "restricted",
      enabledKinds: ["wiki"],
    }, actor);
  assert.equal(created.visibility, "restricted");
  assert.deepEqual(
    ownerRules.map((rule) => rule.action),
    ["read", "create", "update", "delete", "share", "approve", "purge"],
  );
  assert.ok(ownerRules.every((rule) => rule.userId === actor.id && rule.spaceId === SPACE_ID));
});

test("Inhaltstypen werden nur in dafür aktivierten Bereichen angelegt", async () => {
  const service = new SpacesService({
    knowledgeSpace: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === SPACE_ID
          ? {
              id: SPACE_ID,
              visibility: "OPEN",
              enabledKinds: ["WIKI"],
            }
          : null,
    },
  } as unknown as SpacesPrisma);

  assert.equal(await service.resolveOpenSpace("wiki", SPACE_ID), SPACE_ID);
  await assert.rejects(
    service.resolveOpenSpace("standard", SPACE_ID),
    BadRequestException,
  );
  await assert.rejects(
    service.resolveOpenSpace("wiki", DEFAULT_SPACE_ID),
  );

  const restrictedService = new SpacesService({
    knowledgeSpace: {
      findUnique: async () => ({
        id: SPACE_ID,
        visibility: "RESTRICTED",
        enabledKinds: ["WIKI"],
      }),
    },
  } as unknown as SpacesPrisma);
  assert.equal(
    await restrictedService.resolveOpenSpace("wiki", SPACE_ID),
    SPACE_ID,
  );
});

test("Systembereiche und belegte Bereiche können nicht gelöscht werden", async () => {
  const systemService = new SpacesService({
    knowledgeSpace: { findUnique: async () => space(true) },
  } as unknown as SpacesPrisma);
  await assert.rejects(
    systemService.remove(SPACE_ID),
    ForbiddenException,
  );

  const occupiedService = new SpacesService({
    knowledgeSpace: { findUnique: async () => space(false, 1) },
  } as unknown as SpacesPrisma);
  await assert.rejects(
    occupiedService.remove(SPACE_ID),
    ConflictException,
  );
});

test("Von ACLs belegte Bereiche können nicht gelöscht werden", async () => {
  const occupied = space();
  occupied._count.aclBoundaries = 1;
  const service = new SpacesService({
    knowledgeSpace: { findUnique: async () => occupied },
  } as unknown as SpacesPrisma);
  await assert.rejects(service.remove(SPACE_ID), ConflictException);
});

test("Bereichslöschung prüft die Belegung atomar erneut", async () => {
  const service = new SpacesService({
    knowledgeSpace: {
      findUnique: async () => space(),
      deleteMany: async () => ({ count: 0 }),
    },
  } as unknown as SpacesPrisma);
  await assert.rejects(service.remove(SPACE_ID), ConflictException);
});
