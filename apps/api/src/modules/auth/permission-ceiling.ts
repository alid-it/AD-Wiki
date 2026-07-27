import { ForbiddenException } from "@nestjs/common";
import {
  AclEntrySchema,
  PERMISSION_CATALOG,
  RESOURCES,
  type SetAclInput,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";

/** Ermittelt die aktuell wirksamen Rechte als Obergrenze für Delegationen. */
async function effectivePermissionKeys(
  prisma: PrismaService,
  userId: string,
): Promise<Set<string>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { acls: true } }, permissions: true },
  });
  if (!user) {
    throw new ForbiddenException("Der ausführende Benutzer wurde nicht gefunden.");
  }
  if (user.isProtected) {
    return new Set(
      RESOURCES.flatMap((resource) =>
        PERMISSION_CATALOG[resource].map((action) => `${resource}:${action}`),
      ),
    );
  }

  const effective = new Map<string, boolean>();
  for (const entry of user.role.acls) {
    const parsed = AclEntrySchema.safeParse(entry);
    if (parsed.success) {
      effective.set(`${parsed.data.resource}:${parsed.data.action}`, parsed.data.allowed);
    }
  }
  for (const entry of user.permissions) {
    const parsed = AclEntrySchema.safeParse(entry);
    if (parsed.success) {
      effective.set(`${parsed.data.resource}:${parsed.data.action}`, parsed.data.allowed);
    }
  }
  return new Set(
    [...effective.entries()].filter(([, allowed]) => allowed).map(([key]) => key),
  );
}

/** Verhindert, dass ein Verwalter Rechte vergibt, die er selbst nicht besitzt. */
export async function assertMayGrantEntries(
  prisma: PrismaService,
  actorId: string,
  entries: SetAclInput,
): Promise<void> {
  const actorPermissions = await effectivePermissionKeys(prisma, actorId);
  const exceedsCeiling = entries.some(
    (entry) =>
      entry.allowed &&
      !actorPermissions.has(`${entry.resource}:${entry.action}`),
  );
  if (exceedsCeiling) {
    throw new ForbiddenException(
      "Du kannst nur Berechtigungen vergeben, die du selbst besitzt.",
    );
  }
}

/** Prüft dieselbe Obergrenze für die Zuweisung einer bestehenden Rolle. */
export async function assertMayAssignRole(
  prisma: PrismaService,
  actorId: string,
  roleId: string,
): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { acls: true },
  });
  if (!role) {
    throw new ForbiddenException("Die zugewiesene Rolle wurde nicht gefunden.");
  }
  const entries = role.acls.flatMap((entry) => {
    const parsed = AclEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  await assertMayGrantEntries(prisma, actorId, entries);
}
