import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import {
  AddGroupMemberSchema,
  AccessControlChangedEventSchema,
  AuditAction,
  AuditResource,
  CreateGroupSchema,
  GroupMemberCandidatesQuerySchema,
  PERMISSION_CATALOG,
  SOCKET_EVENTS,
  SOCKET_ROOMS,
  UpdateGroupMemberSchema,
  isPermissionSupported,
} from "@ad-wiki/shared-types";
import { GroupsController } from "../../dist/modules/groups/groups.controller.js";
import { GroupsService } from "../../dist/modules/groups/groups.service.js";
import { PermissionService } from "../../dist/modules/auth/permission.service.js";
import { NotificationService } from "../../dist/modules/websocket/notification.service.js";
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from "../../dist/modules/auth/decorators/require-permission.decorator.js";
import type { AuthenticatedUser } from "../../dist/modules/auth/types/jwt-payload.js";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000002";
const MEMBER_ID = "30000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000004";
const ROLE_ID = "50000000-0000-4000-8000-000000000005";
const NOW = new Date("2026-07-23T16:00:00.000Z");

type GroupsPrisma = ConstructorParameters<typeof GroupsService>[0];
type PermissionDependency = ConstructorParameters<typeof GroupsService>[1];
type PermissionPrisma = ConstructorParameters<typeof PermissionService>[0];

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

function actor(
  authenticationMethod: "jwt" | "apiKey" = "jwt",
): AuthenticatedUser {
  return {
    id: ACTOR_ID,
    email: "manager@example.test",
    username: "manager",
    displayName: "Gruppenverwaltung",
    roleId: ROLE_ID,
    role: "viewer",
    isActive: true,
    authenticationMethod,
    apiKeyPermissions:
      authenticationMethod === "apiKey"
        ? [{ resource: "groups", action: "manage_members" }]
        : undefined,
  };
}

function group(memberCount: number, isSystem = false) {
  return {
    id: GROUP_ID,
    name: "IT",
    slug: "it",
    description: null,
    isSystem,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { memberships: memberCount, resourceAclEntries: 0 },
  };
}

function membership(
  userId = MEMBER_ID,
  role: "MEMBER" | "MANAGER" = "MEMBER",
) {
  return {
    id: MEMBERSHIP_ID,
    groupId: GROUP_ID,
    userId,
    role,
    hasLocalGrant: true,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { externalGrants: 0 },
    user: {
      id: userId,
      username: "mitglied",
      displayName: "Mitglied",
      isActive: true,
    },
  };
}

test("Gruppenverträge und Rechtekatalog sind strikt und typisiert", () => {
  const created = CreateGroupSchema.parse({ name: "  IT Betrieb  " });
  assert.equal(created.name, "IT Betrieb");
  assert.equal(created.description, "");

  const added = AddGroupMemberSchema.parse({ userId: MEMBER_ID });
  assert.equal(added.role, "MEMBER");
  assert.equal(
    AddGroupMemberSchema.safeParse({ userId: MEMBER_ID, role: "OWNER" }).success,
    false,
  );
  assert.equal(
    UpdateGroupMemberSchema.safeParse({ role: "MANAGER", globalAdmin: true })
      .success,
    false,
  );

  assert.deepEqual(PERMISSION_CATALOG.groups, [
    "create",
    "read",
    "update",
    "delete",
    "manage_members",
  ]);
  assert.equal(isPermissionSupported("groups", "manage_members"), true);
  assert.equal(isPermissionSupported("groups", "assign_role"), false);
  assert.equal(AuditResource.parse("group"), "group");
  assert.equal(AuditAction.parse("group.member_added"), "group.member_added");
  assert.deepEqual(
    AccessControlChangedEventSchema.parse({
      scope: "groups",
      action: "member_added",
    }),
    {
      scope: "groups",
      action: "member_added",
    },
  );
  assert.deepEqual(
    GroupMemberCandidatesQuerySchema.parse({ q: "  ali  " }),
    { q: "ali" },
  );
  assert.equal(
    GroupMemberCandidatesQuerySchema.safeParse({ q: "ali", role: "admin" })
      .success,
    false,
  );
});

test("globale Gruppenendpunkte verlangen getrennte Rechte", () => {
  const controller = Object.create(
    GroupsController.prototype,
  ) as GroupsController;
  assert.deepEqual(permissionsOf(controller, "findAll"), [
    { resource: "groups", action: "read" },
  ]);
  assert.deepEqual(permissionsOf(controller, "create"), [
    { resource: "groups", action: "create" },
  ]);
  assert.deepEqual(permissionsOf(controller, "update"), [
    { resource: "groups", action: "update" },
  ]);
  assert.deepEqual(permissionsOf(controller, "remove"), [
    { resource: "groups", action: "delete" },
  ]);
});

test("globale Rechte bleiben auch für Gruppenmanager die Obergrenze", async () => {
  let databaseReads = 0;
  const service = new PermissionService({
    userPermission: {
      findUnique: async () => {
        databaseReads += 1;
        return { allowed: false };
      },
    },
    acl: {
      findUnique: async () => {
        databaseReads += 1;
        return { allowed: true };
      },
    },
  } as unknown as PermissionPrisma);

  assert.equal(
    await service.isAllowed(actor(), "groups", "manage_members"),
    false,
  );
  assert.equal(databaseReads, 2);

  const apiKeyActor = actor("apiKey");
  apiKeyActor.apiKeyPermissions = [];
  assert.equal(
    await service.isAllowed(apiKeyActor, "groups", "manage_members"),
    false,
  );
  assert.equal(databaseReads, 2);
});

test("Gruppenmanager dürfen Mitglieder, aber keine weiteren Manager ernennen", async () => {
  let created = 0;
  const prisma = {
    group: {
      findUnique: async () => ({ id: GROUP_ID }),
    },
    groupMembership: {
      findUnique: async () => ({ role: "MANAGER" }),
      create: async () => {
        created += 1;
        return membership();
      },
    },
    user: {
      findUnique: async () => ({ id: MEMBER_ID, isActive: true }),
    },
  } as unknown as GroupsPrisma;
  const permissions = {
    isAllowed: async () => false,
  } as unknown as PermissionDependency;
  const service = new GroupsService(prisma, permissions);

  const result = await service.addMember(
    GROUP_ID,
    { userId: MEMBER_ID, role: "MEMBER" },
    actor(),
  );
  assert.equal(result.role, "MEMBER");
  assert.equal(created, 1);

  await assert.rejects(
    service.addMember(
      GROUP_ID,
      { userId: randomUUID(), role: "MANAGER" },
      actor(),
    ),
    ForbiddenException,
  );
  assert.equal(created, 1);
});

test("Gruppenmanager sehen sichere Kandidaten nur für ihre eigene Gruppe", async () => {
  let candidateQuery: unknown;
  const service = new GroupsService(
    {
      group: {
        findUnique: async () => ({ id: GROUP_ID }),
      },
      groupMembership: {
        findUnique: async () => ({ role: "MANAGER" }),
      },
      user: {
        findMany: async (query: unknown) => {
          candidateQuery = query;
          return [
            {
              id: MEMBER_ID,
              username: "ali",
              displayName: "Ali",
              isActive: true,
            },
          ];
        },
      },
    } as unknown as GroupsPrisma,
    { isAllowed: async () => false } as unknown as PermissionDependency,
  );

  const candidates = await service.findMemberCandidates(
    GROUP_ID,
    { q: "ali" },
    actor(),
  );
  assert.equal(candidates[0]?.username, "ali");
  assert.deepEqual(
    (candidateQuery as {
      where: {
        groupMemberships: {
          none: { groupId: string; hasLocalGrant: boolean };
        };
      };
      take: number;
      select: Record<string, boolean>;
    }).where.groupMemberships,
    { none: { groupId: GROUP_ID, hasLocalGrant: true } },
  );
  assert.equal(
    (candidateQuery as { take: number }).take,
    100,
  );
  assert.deepEqual(
    Object.keys((candidateQuery as { select: Record<string, boolean> }).select),
    ["id", "username", "displayName", "isActive"],
  );
});

test("Lokale Gruppenmanager dürfen Mitgliedschaftsrollen nicht ändern", async () => {
  const service = new GroupsService(
    {
      group: {
        findUnique: async () => ({ id: GROUP_ID }),
      },
      groupMembership: {
        findUnique: async () => ({ role: "MANAGER" }),
      },
    } as unknown as GroupsPrisma,
    { isAllowed: async () => false } as unknown as PermissionDependency,
  );

  await assert.rejects(
    service.updateMember(
      GROUP_ID,
      MEMBER_ID,
      { role: "MANAGER" },
      actor(),
    ),
    ForbiddenException,
  );
});

test("Zugriffsänderungen werden als typisiertes globales WebSocket-Signal gesendet", () => {
  let emitted:
    | { room: string; event: string; data: unknown }
    | undefined;
  const notifications = new NotificationService();
  notifications.bindServer({
    to: (room: string) => ({
      emit: (event: string, data: unknown) => {
        emitted = { room, event, data };
      },
    }),
  } as never);

  notifications.notifyPermissionsUpdated(
    "groups",
    "member_added",
  );

  assert.deepEqual(emitted, {
    room: SOCKET_ROOMS.global,
    event: SOCKET_EVENTS.permissionsUpdated,
    data: {
      scope: "groups",
      action: "member_added",
    },
  });
});

test("API-Keys erhalten keinen impliziten Gruppenmanager-Bypass", async () => {
  const service = new GroupsService(
    {
      group: {
        findUnique: async () => ({ id: GROUP_ID }),
      },
      groupMembership: {
        findUnique: async () => ({ role: "MANAGER" }),
      },
    } as unknown as GroupsPrisma,
    { isAllowed: async () => false } as unknown as PermissionDependency,
  );

  await assert.rejects(
    service.addMember(
      GROUP_ID,
      { userId: MEMBER_ID, role: "MEMBER" },
      actor("apiKey"),
    ),
    ForbiddenException,
  );
});

test("Systemgruppen und belegte Gruppen können nicht gelöscht werden", async () => {
  const systemService = new GroupsService(
    {
      group: { findUnique: async () => group(0, true) },
    } as unknown as GroupsPrisma,
    {} as PermissionDependency,
  );
  await assert.rejects(
    systemService.remove(GROUP_ID),
    ForbiddenException,
  );

  const occupiedService = new GroupsService(
    {
      group: { findUnique: async () => group(2) },
    } as unknown as GroupsPrisma,
    {} as PermissionDependency,
  );
  await assert.rejects(
    occupiedService.remove(GROUP_ID),
    ConflictException,
  );
});

test("Von Ressourcen-ACLs verwendete Gruppen können nicht gelöscht werden", async () => {
  const occupied = group(0);
  occupied._count.resourceAclEntries = 1;
  const service = new GroupsService(
    {
      group: { findUnique: async () => occupied },
    } as unknown as GroupsPrisma,
    {} as PermissionDependency,
  );
  await assert.rejects(service.remove(GROUP_ID), ConflictException);
});

test("Gruppenlöschung prüft die Belegung nochmals atomar", async () => {
  const service = new GroupsService(
    {
      group: {
        findUnique: async () => group(0),
        deleteMany: async () => ({ count: 0 }),
      },
    } as unknown as GroupsPrisma,
    {} as PermissionDependency,
  );

  await assert.rejects(service.remove(GROUP_ID), ConflictException);
});
