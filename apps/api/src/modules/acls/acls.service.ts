import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ACTIONS,
  AclEntrySchema,
  RESOURCES,
  isPermissionSupported,
  type AclEntry,
  type CreateRoleInput,
  type SetAclInput,
  type UpdateRoleInput,
} from "@ad-wiki/shared-types";
import { assertMayGrantEntries } from "@/modules/auth/permission-ceiling";
import { PrismaService } from "@/prisma/prisma.service";

/**
 * Verwaltung der rollenbasierten ACLs sowie individueller User-Permissions.
 * Beide werden als vollständige Liste gesetzt (ersetzt den bisherigen Stand).
 */
@Injectable()
export class AclsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Alle Rollen mit ihren Rechten plus die Achsen der Rechte-Matrix. */
  async getOverview() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { acls: true, _count: { select: { users: true } } },
    });

    return {
      resources: [...RESOURCES],
      actions: [...ACTIONS],
      roles: roles.map((role) => ({
        roleId: role.id,
        roleName: role.name,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.users,
        createdAt: role.createdAt.toISOString(),
        entries: role.acls.flatMap((entry) => {
          const parsed = AclEntrySchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        }),
      })),
    };
  }

  /** Legt eine zusätzliche, zunächst rechtefreie Rolle an. */
  async createRole(input: CreateRoleInput) {
    const existing = await this.prisma.role.findUnique({
      where: { name: input.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Die Rolle "${input.name}" existiert bereits.`);
    }
    const role = await this.prisma.role.create({
      data: {
        name: input.name,
        description: input.description || null,
        isSystem: false,
      },
      include: { _count: { select: { users: true } } },
    });
    return this.toRole(role);
  }

  /** Bearbeitet Namen und Beschreibung einer Rolle. */
  async updateRole(id: string, input: UpdateRoleInput) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException("Rolle nicht gefunden.");
    }
    if (role.isSystem && input.name !== undefined && input.name !== role.name) {
      throw new ForbiddenException("Der Name einer Systemrolle kann nicht geändert werden.");
    }
    if (input.name && input.name !== role.name) {
      const duplicate = await this.prisma.role.findUnique({
        where: { name: input.name },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(`Die Rolle "${input.name}" existiert bereits.`);
      }
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const next = await transaction.role.update({
        where: { id },
        data: {
          name: input.name,
          description:
            input.description === undefined ? undefined : input.description || null,
        },
        include: { _count: { select: { users: true } } },
      });
      if (input.name && input.name !== role.name) {
        await transaction.setting.updateMany({
          where: { key: "default_role", value: role.name },
          data: { value: input.name },
        });
      }
      return next;
    });
    return this.toRole(updated);
  }

  /** Entfernt ausschließlich unbenutzte, nicht systemeigene Rollen. */
  async deleteRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            identityProviderDefaults: true,
            identityProviderMappings: true,
          },
        },
      },
    });
    if (!role) {
      throw new NotFoundException("Rolle nicht gefunden.");
    }
    if (role.isSystem) {
      throw new ForbiddenException("Systemrollen können nicht gelöscht werden.");
    }
    if (role._count.users > 0) {
      throw new ConflictException(
        "Die Rolle ist noch Benutzern zugewiesen und kann nicht gelöscht werden.",
      );
    }
    if (
      role._count.identityProviderDefaults > 0 ||
      role._count.identityProviderMappings > 0
    ) {
      throw new ConflictException(
        "Die Rolle wird noch von einem Identity Provider verwendet und kann nicht gelöscht werden.",
      );
    }
    const defaultRole = await this.prisma.setting.findUnique({
      where: { key: "default_role" },
      select: { value: true },
    });
    if (defaultRole?.value === role.name) {
      throw new ConflictException(
        "Die Standardrolle für neue Benutzer kann nicht gelöscht werden.",
      );
    }
    await this.prisma.role.delete({ where: { id } });
    return this.toRole(role);
  }

  /** Setzt die Rechte einer Rolle komplett neu. */
  async setRoleAcls(roleId: string, entries: SetAclInput, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException("Rolle nicht gefunden.");
    }

    await assertMayGrantEntries(this.prisma, actorId, entries);
    await this.prisma.$transaction([
      this.prisma.acl.deleteMany({ where: { roleId } }),
      this.prisma.acl.createMany({
        data: this.dedupe(entries).map((e) => ({
          roleId,
          resource: e.resource,
          action: e.action,
          allowed: e.allowed,
        })),
      }),
    ]);

    return this.getRoleEntries(roleId);
  }

  /** Individuelle Permissions eines Users lesen. */
  async getUserPermissions(userId: string): Promise<AclEntry[]> {
    await this.ensureUser(userId);
    const perms = await this.prisma.userPermission.findMany({ where: { userId } });
    return perms.flatMap((entry) => {
      const parsed = AclEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  /** Individuelle Permissions eines Users komplett neu setzen. */
  async setUserPermissions(
    userId: string,
    entries: SetAclInput,
    actorId: string,
  ): Promise<AclEntry[]> {
    if (userId === actorId) {
      throw new ForbiddenException(
        "Du kannst deine eigenen individuellen Rechte nicht ändern.",
      );
    }
    await this.ensureUserIsManageable(userId);
    await assertMayGrantEntries(this.prisma, actorId, entries);
    await this.prisma.$transaction([
      this.prisma.userPermission.deleteMany({ where: { userId } }),
      this.prisma.userPermission.createMany({
        data: this.dedupe(entries).map((e) => ({
          userId,
          resource: e.resource,
          action: e.action,
          allowed: e.allowed,
        })),
      }),
    ]);
    return this.getUserPermissions(userId);
  }

  private async getRoleEntries(roleId: string): Promise<AclEntry[]> {
    const acls = await this.prisma.acl.findMany({ where: { roleId } });
    return acls.flatMap((entry) => {
      const parsed = AclEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  private async ensureUser(userId: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) {
      throw new NotFoundException("Benutzer nicht gefunden.");
    }
  }

  private async ensureUserIsManageable(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isProtected: true },
    });
    if (!user) {
      throw new NotFoundException("Benutzer nicht gefunden.");
    }
    if (user.isProtected) {
      throw new ForbiddenException("Die Rechte des geschützten Setup-Admin-Kontos können nicht geändert werden.");
    }
  }

  /** Entfernt doppelte (resource, action)-Paare – der Unique-Constraint erlaubt nur eines. */
  private dedupe(entries: SetAclInput): SetAclInput {
    const seen = new Map<string, (typeof entries)[number]>();
    for (const e of entries) {
      if (!isPermissionSupported(e.resource, e.action)) continue;
      seen.set(`${e.resource}:${e.action}`, e);
    }
    return [...seen.values()];
  }

  private toRole(role: {
    id: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    createdAt: Date;
    _count: { users: number };
  }) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount: role._count.users,
      createdAt: role.createdAt.toISOString(),
    };
  }
}
