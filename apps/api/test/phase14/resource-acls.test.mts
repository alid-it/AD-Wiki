import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import {
  CreateResourceAclEntrySchema,
  EvaluateResourceAccessSchema,
  PERMISSION_CATALOG,
  ResourceAccessDecisionSchema,
  ResourceAclListQuerySchema,
  SetResourceAclBoundarySchema,
} from "@ad-wiki/shared-types";
import { ResourceAccessService } from "../../dist/modules/resource-acls/resource-access.service.js";
import { ResourceAclsController } from "../../dist/modules/resource-acls/resource-acls.controller.js";
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from "../../dist/modules/auth/decorators/require-permission.decorator.js";
import type { AuthenticatedUser } from "../../dist/modules/auth/types/jwt-payload.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const GROUP_A = "20000000-0000-4000-8000-000000000002";
const GROUP_B = "30000000-0000-4000-8000-000000000003";
const PAGE_ID = "40000000-0000-4000-8000-000000000004";
const CATEGORY_ID = "50000000-0000-4000-8000-000000000005";
const SPACE_ID = "60000000-0000-4000-8000-000000000006";
const RULE_ID = "70000000-0000-4000-8000-000000000007";

type AccessPrisma = ConstructorParameters<typeof ResourceAccessService>[0];
type PermissionDependency =
  ConstructorParameters<typeof ResourceAccessService>[1];
type TargetDependency = ConstructorParameters<typeof ResourceAccessService>[2];

const pageTarget = {
  type: "page" as const,
  id: PAGE_ID,
  label: "DNS",
  key: `page:${PAGE_ID}`,
  allowedResources: ["pages" as const],
};
const categoryTarget = {
  type: "category" as const,
  id: CATEGORY_ID,
  label: "Netzwerk",
  key: `category:${CATEGORY_ID}`,
  allowedResources: ["categories" as const, "pages" as const],
};
const spaceTarget = {
  type: "space" as const,
  id: SPACE_ID,
  label: "IT",
  key: `space:${SPACE_ID}`,
  allowedResources: [
    "pages" as const,
    "categories" as const,
    "notes" as const,
    "standards" as const,
    "spaces" as const,
  ],
};

function actor(): AuthenticatedUser {
  return {
    id: USER_ID,
    email: "user@example.test",
    username: "user",
    displayName: "User",
    roleId: "80000000-0000-4000-8000-000000000008",
    role: "viewer",
    isActive: true,
    authenticationMethod: "jwt",
  };
}

function hierarchy(visibility: "open" | "restricted" = "restricted") {
  return {
    path: [pageTarget, categoryTarget, spaceTarget],
    spaceVisibility: visibility,
    personalNote: null,
  };
}

function targets(
  visibility: "open" | "restricted" = "restricted",
): TargetDependency {
  return {
    resolveHierarchy: async () => hierarchy(visibility),
    assertResourceMatches: () => undefined,
    assertActionSupported: () => undefined,
  } as unknown as TargetDependency;
}

function permissionsOf(method: string): RequiredPermission[] {
  const target = ResourceAclsController.prototype as unknown as Record<
    string,
    object
  >;
  const metadata = Reflect.getMetadata(
    PERMISSION_KEY,
    target[method],
  ) as RequiredPermission | RequiredPermission[] | undefined;
  if (!metadata) return [];
  return Array.isArray(metadata) ? metadata : [metadata];
}

test("ACL-Verträge sind strikt und verwenden den zentralen Rechtekatalog", () => {
  assert.deepEqual(PERMISSION_CATALOG.resource_acls, ["read", "update"]);
  assert.equal(
    CreateResourceAclEntrySchema.safeParse({
      recipientType: "group",
      recipientId: GROUP_A,
      targetType: "page",
      targetId: PAGE_ID,
      action: "read",
      effect: "allow",
      unknown: true,
    }).success,
    false,
  );
  assert.equal(
    ResourceAclListQuerySchema.safeParse({ targetType: "page" }).success,
    false,
  );
  assert.equal(
    SetResourceAclBoundarySchema.parse({
      targetType: "category",
      targetId: CATEGORY_ID,
      action: "update",
    }).action,
    "update",
  );
  assert.equal(
    EvaluateResourceAccessSchema.safeParse({
      userId: USER_ID,
      resource: "pages",
      action: "read",
      targetType: "page",
      targetId: PAGE_ID,
    }).success,
    true,
  );
});

test("Verwaltung und Vorschau verlangen getrennte globale Rechte", () => {
  assert.deepEqual(permissionsOf("findAll"), [
    { resource: "resource_acls", action: "read" },
  ]);
  assert.deepEqual(permissionsOf("evaluate"), [
    { resource: "resource_acls", action: "read" },
  ]);
  assert.deepEqual(permissionsOf("create"), [
    { resource: "resource_acls", action: "update" },
  ]);
  assert.deepEqual(permissionsOf("setBoundary"), [
    { resource: "resource_acls", action: "update" },
  ]);
});

test("Ein globales Verbot beendet die Prüfung vor dem Laden des Ziels", async () => {
  let targetReads = 0;
  const service = new ResourceAccessService(
    {} as AccessPrisma,
    { isAllowed: async () => false } as unknown as PermissionDependency,
    {
      resolveHierarchy: async () => {
        targetReads += 1;
        return hierarchy();
      },
    } as unknown as TargetDependency,
  );
  const decision = await service.evaluate(actor(), {
    resource: "pages",
    action: "read",
    targetType: "page",
    targetId: PAGE_ID,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "global_denied");
  assert.deepEqual(decision.evaluatedPath, []);
  assert.equal(targetReads, 0);
});

test("User-Regel am Ziel schlägt ein Gruppen-DENY am selben Ziel", async () => {
  const service = new ResourceAccessService(
    {
      groupMembership: {
        findMany: async () => [{ groupId: GROUP_A }],
      },
      resourceAclEntry: {
        findMany: async () => [
          {
            id: RULE_ID,
            targetKey: pageTarget.key,
            effect: "ALLOW",
            inheritToChildren: true,
            userId: USER_ID,
            groupId: null,
          },
          {
            id: "71000000-0000-4000-8000-000000000007",
            targetKey: pageTarget.key,
            effect: "DENY",
            inheritToChildren: true,
            userId: null,
            groupId: GROUP_A,
          },
        ],
      },
      resourceAclBoundary: { findMany: async () => [] },
    } as unknown as AccessPrisma,
    { isAllowed: async () => true } as unknown as PermissionDependency,
    targets(),
  );
  const decision = await service.evaluate(actor(), {
    resource: "pages",
    action: "read",
    targetType: "page",
    targetId: PAGE_ID,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "direct_user_allow");
  assert.equal(decision.ruleId, RULE_ID);
  ResourceAccessDecisionSchema.parse(decision);
});

test("Bei geerbten Gruppenregeln gewinnt DENY unabhängig von der Reihenfolge", async () => {
  const service = new ResourceAccessService(
    {
      groupMembership: {
        findMany: async () => [{ groupId: GROUP_A }, { groupId: GROUP_B }],
      },
      resourceAclEntry: {
        findMany: async () => [
          {
            id: RULE_ID,
            targetKey: categoryTarget.key,
            effect: "ALLOW",
            inheritToChildren: true,
            userId: null,
            groupId: GROUP_A,
          },
          {
            id: "72000000-0000-4000-8000-000000000007",
            targetKey: categoryTarget.key,
            effect: "DENY",
            inheritToChildren: true,
            userId: null,
            groupId: GROUP_B,
          },
        ],
      },
      resourceAclBoundary: { findMany: async () => [] },
    } as unknown as AccessPrisma,
    { isAllowed: async () => true } as unknown as PermissionDependency,
    targets("open"),
  );
  const decision = await service.evaluate(actor(), {
    resource: "pages",
    action: "read",
    targetType: "page",
    targetId: PAGE_ID,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "inherited_group_deny");
});

test("Nicht vererbbare Regeln werden übersprungen und Grenzen stoppen Elternregeln", async () => {
  const service = new ResourceAccessService(
    {
      groupMembership: { findMany: async () => [{ groupId: GROUP_A }] },
      resourceAclEntry: {
        findMany: async () => [
          {
            id: RULE_ID,
            targetKey: categoryTarget.key,
            effect: "ALLOW",
            inheritToChildren: false,
            userId: null,
            groupId: GROUP_A,
          },
          {
            id: "73000000-0000-4000-8000-000000000007",
            targetKey: spaceTarget.key,
            effect: "ALLOW",
            inheritToChildren: true,
            userId: null,
            groupId: GROUP_A,
          },
        ],
      },
      resourceAclBoundary: {
        findMany: async () => [{ targetKey: categoryTarget.key }],
      },
    } as unknown as AccessPrisma,
    { isAllowed: async () => true } as unknown as PermissionDependency,
    targets("restricted"),
  );
  const decision = await service.evaluate(actor(), {
    resource: "pages",
    action: "read",
    targetType: "page",
    targetId: PAGE_ID,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "inheritance_boundary_restricted");
  assert.equal(decision.sourceTarget?.id, CATEGORY_ID);
});

test("Batch-Auswertung löst Listen ohne N+1-Abfragen auf", async () => {
  let hierarchyCalls = 0;
  let membershipCalls = 0;
  let entryCalls = 0;
  let boundaryCalls = 0;
  const secondPageId = "90000000-0000-4000-8000-000000000009";
  const prisma = {
    groupMembership: {
      findMany: async () => {
        membershipCalls += 1;
        return [];
      },
    },
    resourceAclEntry: {
      findMany: async () => {
        entryCalls += 1;
        return [];
      },
    },
    resourceAclBoundary: {
      findMany: async () => {
        boundaryCalls += 1;
        return [];
      },
    },
  } as unknown as AccessPrisma;
  const service = new ResourceAccessService(
    prisma,
    { isAllowed: async () => true } as unknown as PermissionDependency,
    {
      resolveHierarchies: async () => {
        hierarchyCalls += 1;
        return new Map([
          [PAGE_ID, hierarchy("restricted")],
          [
            secondPageId,
            {
              ...hierarchy("restricted"),
              path: [
                { ...pageTarget, id: secondPageId, key: `page:${secondPageId}` },
                categoryTarget,
                spaceTarget,
              ],
            },
          ],
        ]);
      },
      assertResourceMatches: () => undefined,
      assertActionSupported: () => undefined,
    } as unknown as TargetDependency,
  );

  const decisions = await service.evaluateMany(actor(), {
    resource: "pages",
    action: "read",
    targetType: "page",
    targetIds: [PAGE_ID, secondPageId],
  });

  assert.equal(decisions.get(PAGE_ID)?.allowed, false);
  assert.equal(decisions.get(secondPageId)?.allowed, false);
  assert.deepEqual(
    { hierarchyCalls, membershipCalls, entryCalls, boundaryCalls },
    { hierarchyCalls: 1, membershipCalls: 1, entryCalls: 1, boundaryCalls: 1 },
  );
});
