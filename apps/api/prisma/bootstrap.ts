import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcrypt";
import {
  PERMISSION_CATALOG,
  RESOURCES,
  type Action,
  type Resource,
} from "@ad-wiki/shared-types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the production bootstrap");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const SALT_ROUNDS = 12;
const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000014";

type Permission = readonly [resource: Resource, action: Action];

const adminPermissions: Permission[] = RESOURCES.flatMap((resource) =>
  PERMISSION_CATALOG[resource].map((action) => [resource, action] as Permission),
);

const roleDefinitions = [
  {
    name: "admin",
    description: "Vollzugriff auf alle Ressourcen",
    permissions: adminPermissions,
  },
  {
    name: "editor",
    description: "Darf Inhalte erstellen und bearbeiten",
    permissions: [
      ["pages", "create"], ["pages", "read"], ["pages", "update"], ["categories", "read"], ["spaces", "read"],
      ["media", "create"], ["media", "read"], ["media", "delete"],
      ["notes", "create"], ["notes", "read"], ["notes", "update"], ["notes", "delete"], ["notes", "share"],
      ["standards", "create"], ["standards", "read"], ["standards", "update"],
      ["mcp", "create"], ["mcp", "read"], ["mcp", "delete"],
      ["integrations", "create"], ["integrations", "read"], ["integrations", "update"], ["integrations", "delete"],
    ] satisfies Permission[],
  },
  {
    name: "viewer",
    description: "Nur-Lese-Zugriff auf veröffentlichte Inhalte",
    permissions: [
      ["pages", "read"], ["categories", "read"], ["spaces", "read"], ["media", "read"],
      ["notes", "create"], ["notes", "read"], ["notes", "update"], ["notes", "delete"], ["notes", "share"],
      ["standards", "read"],
      ["mcp", "create"], ["mcp", "read"], ["mcp", "delete"],
      ["integrations", "create"], ["integrations", "read"], ["integrations", "update"], ["integrations", "delete"],
    ] satisfies Permission[],
  },
] as const;

async function bootstrap(): Promise<void> {
  const roles = new Map<string, { id: string }>();

  for (const definition of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { name: definition.name },
      update: { description: definition.description, isSystem: true },
      create: { name: definition.name, description: definition.description, isSystem: true },
    });
    roles.set(definition.name, role);

    for (const [resource, action] of definition.permissions) {
      await prisma.acl.upsert({
        where: { roleId_resource_action: { roleId: role.id, resource, action } },
        update: { allowed: true },
        create: { roleId: role.id, resource, action, allowed: true },
      });
    }
  }

  const settings = [
    ["site_name", process.env.SITE_NAME ?? "AD-Wiki", "string", "Name der Wiki-Instanz"],
    ["allow_registration", process.env.ALLOW_REGISTRATION ?? "false", "boolean", "Öffentliche Registrierung erlauben"],
  ] as const;

  for (const [key, value, type, description] of settings) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value, type, description },
    });
  }

  await prisma.knowledgeSpace.upsert({
    where: { id: DEFAULT_SPACE_ID },
    update: {
      visibility: "OPEN",
      enabledKinds: ["WIKI", "NOTE", "STANDARD"],
      isSystem: true,
    },
    create: {
      id: DEFAULT_SPACE_ID,
      name: "Allgemein",
      slug: "allgemein",
      description: "Offener Standardbereich für bestehende Wissensinhalte",
      visibility: "OPEN",
      enabledKinds: ["WIKI", "NOTE", "STANDARD"],
      isSystem: true,
    },
  });

  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const username = process.env.INITIAL_ADMIN_USERNAME?.trim();
  const displayName = process.env.INITIAL_ADMIN_DISPLAY_NAME?.trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!email || !username || !displayName || !password) {
    throw new Error("INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_DISPLAY_NAME and INITIAL_ADMIN_PASSWORD are required");
  }
  if (password.length < 12) {
    throw new Error("INITIAL_ADMIN_PASSWORD must contain at least 12 characters");
  }

  const adminRole = roles.get("admin");
  if (!adminRole) throw new Error("Admin role bootstrap failed");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { isProtected: true, id: { not: existing.id } },
        data: { isProtected: false },
      }),
      prisma.user.update({
        where: { id: existing.id },
        data: { roleId: adminRole.id, isActive: true, isProtected: true },
      }),
    ]);
    console.log(`Production bootstrap verified existing admin ${email}`);
    return;
  }

  const usernameOwner = await prisma.user.findUnique({ where: { username } });
  if (usernameOwner) {
    throw new Error(`INITIAL_ADMIN_USERNAME '${username}' is already used by another account`);
  }

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { isProtected: true },
      data: { isProtected: false },
    }),
    prisma.user.create({
      data: {
        email,
        username,
        displayName,
        password: await bcrypt.hash(password, SALT_ROUNDS),
        roleId: adminRole.id,
        isActive: true,
        isProtected: true,
      },
    }),
  ]);
  console.log(`Production bootstrap created initial admin ${email}`);
}

bootstrap()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
