import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import {
  ACTIONS,
  AclEntrySchema,
  AssignUserRoleSchema,
  PERMISSION_CATALOG,
  RESOURCES,
  UpdateUserSchema,
  isPermissionSupported,
} from "@ad-wiki/shared-types";
import { AclsController } from "../../dist/modules/acls/acls.controller.js";
import { AclsService } from "../../dist/modules/acls/acls.service.js";
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from "../../dist/modules/auth/decorators/require-permission.decorator.js";
import { UsersController } from "../../dist/modules/users/users.controller.js";
import { assertMayAssignRole } from "../../dist/modules/auth/permission-ceiling.js";

type CeilingPrisma = Parameters<typeof assertMayAssignRole>[0];
type AclsPrisma = ConstructorParameters<typeof AclsService>[0];

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

test("der explizite Katalog ist die einzige Quelle unterstützter Rechte", () => {
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      assert.equal(
        isPermissionSupported(resource, action),
        (PERMISSION_CATALOG[resource] as readonly string[]).includes(action),
      );
    }
  }

  assert.equal(isPermissionSupported("settings", "create"), false);
  assert.equal(isPermissionSupported("settings", "delete"), false);
  assert.equal(isPermissionSupported("users", "assign_role"), true);
  assert.equal(isPermissionSupported("users", "reset_password"), true);
  assert.equal(isPermissionSupported("pages", "purge"), true);
  assert.equal(isPermissionSupported("smtp", "test"), true);
  assert.equal(isPermissionSupported("roles", "create"), true);
  assert.equal(isPermissionSupported("roles", "delete"), true);
});

test("ACL- und Benutzerverträge lehnen Rechteausweitung über alte Felder ab", () => {
  assert.equal(
    AclEntrySchema.safeParse({
      resource: "settings",
      action: "create",
      allowed: true,
    }).success,
    false,
  );
  assert.equal(UpdateUserSchema.safeParse({ role: "admin" }).success, false);
  assert.equal(UpdateUserSchema.safeParse({ isActive: false }).success, true);
  assert.equal(
    AssignUserRoleSchema.safeParse({
      roleId: "11111111-1111-4111-8111-111111111111",
    }).success,
    true,
  );
  assert.equal(AssignUserRoleSchema.safeParse({ role: "editor" }).success, false);
});

test("Benutzer- und Rechteverwaltung verlangen getrennte sensible Rechte", () => {
  const users = Object.create(UsersController.prototype) as UsersController;
  const acls = Object.create(AclsController.prototype) as AclsController;

  assert.deepEqual(permissionsOf(users, "create"), [
    { resource: "users", action: "create" },
    { resource: "users", action: "assign_role" },
  ]);
  assert.deepEqual(permissionsOf(users, "update"), [
    { resource: "users", action: "update" },
  ]);
  assert.deepEqual(permissionsOf(users, "assignRole"), [
    { resource: "users", action: "assign_role" },
  ]);
  assert.deepEqual(permissionsOf(users, "resetPassword"), [
    { resource: "users", action: "reset_password" },
  ]);
  assert.deepEqual(permissionsOf(acls, "setRole"), [
    { resource: "roles", action: "update" },
  ]);
  assert.deepEqual(permissionsOf(acls, "createRole"), [
    { resource: "roles", action: "create" },
  ]);
  assert.deepEqual(permissionsOf(acls, "deleteRole"), [
    { resource: "roles", action: "delete" },
  ]);
  assert.deepEqual(permissionsOf(acls, "setUserPermissions"), [
    { resource: "user_permissions", action: "update" },
  ]);
});

test("Systemrollen und belegte Rollen sind gegen Löschen geschützt", async () => {
  const systemService = new AclsService({
    role: {
      findUnique: async () => ({
        id: "system",
        name: "admin",
        description: null,
        isSystem: true,
        createdAt: new Date(),
        _count: { users: 0 },
      }),
    },
  } as unknown as AclsPrisma);
  await assert.rejects(systemService.deleteRole("system"), ForbiddenException);

  const usedService = new AclsService({
    role: {
      findUnique: async () => ({
        id: "custom",
        name: "support",
        description: null,
        isSystem: false,
        createdAt: new Date(),
        _count: { users: 2 },
      }),
    },
  } as unknown as AclsPrisma);
  await assert.rejects(usedService.deleteRole("custom"));
});

test("delegierte Verwaltung kann keine höheren Rechte oder eigene Overrides vergeben", async () => {
  const prisma = {
    role: {
      findUnique: async () => ({
        acls: [{ resource: "users", action: "assign_role", allowed: true }],
      }),
    },
    user: {
      findUnique: async () => ({
        isProtected: false,
        role: {
          acls: [{ resource: "users", action: "read", allowed: true }],
        },
        permissions: [],
      }),
    },
  } as unknown as CeilingPrisma;

  await assert.rejects(
    assertMayAssignRole(prisma, "actor", "admin-role"),
    ForbiddenException,
  );

  const acls = new AclsService({} as AclsPrisma);
  await assert.rejects(
    acls.setUserPermissions("actor", [], "actor"),
    ForbiddenException,
  );
});
