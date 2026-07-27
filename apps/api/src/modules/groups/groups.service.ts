import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type GroupMembershipRole } from "@prisma/client";
import slugify from "slugify";
import type {
  AddGroupMemberInput,
  CreateGroupInput,
  GroupMemberCandidatesQuery,
  UpdateGroupInput,
  UpdateGroupMemberInput,
} from "@ad-wiki/shared-types";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { PermissionService } from "@/modules/auth/permission.service";
import { PrismaService } from "@/prisma/prisma.service";

const groupWithCount = {
  _count: {
    select: {
      memberships: true,
      resourceAclEntries: true,
      identityProviderMappings: true,
    },
  },
} satisfies Prisma.GroupInclude;

const membershipWithUser = {
  user: {
    select: {
      id: true,
      username: true,
      displayName: true,
      isActive: true,
    },
  },
  _count: { select: { externalGrants: true } },
} satisfies Prisma.GroupMembershipInclude;

type GroupWithCount = Prisma.GroupGetPayload<{
  include: typeof groupWithCount;
}>;
type MembershipWithUser = Prisma.GroupMembershipGetPayload<{
  include: typeof membershipWithUser;
}>;
type MembershipAuthority = "GLOBAL" | "GROUP_MANAGER";

/** Geschäftslogik für Gruppen, Mitgliedschaften und begrenzte Gruppenverwalter. */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async findAll() {
    const groups = await this.prisma.group.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      include: groupWithCount,
    });
    return groups.map((group) => this.toGroup(group));
  }

  async findById(id: string) {
    return this.toGroup(await this.findGroup(id));
  }

  /** Liefert ausschließlich die eigenen Gruppen und verrät keine fremden Mitglieder. */
  async findOwnMemberships(userId: string) {
    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId },
      orderBy: { group: { name: "asc" } },
      include: {
        _count: { select: { externalGrants: true } },
        group: {
          include: groupWithCount,
        },
      },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      role: membership.role,
      hasLocalGrant: membership.hasLocalGrant,
      externalGrantCount: membership._count.externalGrants,
      createdAt: membership.createdAt.toISOString(),
      group: this.toGroup(membership.group),
    }));
  }

  async create(input: CreateGroupInput) {
    await this.assertNameAvailable(input.name);
    const slug = await this.generateUniqueSlug(input.name);

    try {
      const group = await this.prisma.group.create({
        data: {
          name: input.name,
          slug,
          description: input.description || null,
        },
        include: groupWithCount,
      });
      return this.toGroup(group);
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  async update(id: string, input: UpdateGroupInput) {
    const existing = await this.findGroup(id);
    if (
      existing.isSystem &&
      input.name !== undefined &&
      input.name !== existing.name
    ) {
      throw new ForbiddenException(
        "Der Name einer Systemgruppe kann nicht geändert werden.",
      );
    }

    if (input.name !== undefined && input.name !== existing.name) {
      await this.assertNameAvailable(input.name, id);
    }
    const nextSlug =
      input.name !== undefined && input.name !== existing.name
        ? await this.generateUniqueSlug(input.name, id)
        : undefined;

    try {
      const group = await this.prisma.group.update({
        where: { id },
        data: {
          name: input.name,
          slug: nextSlug,
          description:
            input.description === undefined
              ? undefined
              : input.description || null,
        },
        include: groupWithCount,
      });
      return this.toGroup(group);
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  /**
   * Löscht nur leere, frei verwaltbare Gruppen. Künftige Ressourcen-ACLs werden
   * Phase 14C als weitere Belegungsprüfung ergänzen.
   */
  async remove(id: string) {
    const group = await this.findGroup(id);
    if (group.isSystem) {
      throw new ForbiddenException("Systemgruppen können nicht gelöscht werden.");
    }
    if (group._count.memberships > 0) {
      throw new ConflictException(
        "Die Gruppe enthält noch Mitglieder und kann nicht gelöscht werden.",
      );
    }

    if (group._count.resourceAclEntries > 0) {
      throw new ConflictException(
        "Die Gruppe wird noch von Ressourcen-ACLs verwendet und kann nicht gelöscht werden.",
      );
    }
    if (group._count.identityProviderMappings > 0) {
      throw new ConflictException(
        "Die Gruppe wird noch von einem Identity-Provider-Mapping verwendet und kann nicht gelöscht werden.",
      );
    }

    const deleted = await this.prisma.group.deleteMany({
      where: {
        id,
        isSystem: false,
        memberships: { none: {} },
        resourceAclEntries: { none: {} },
        identityProviderMappings: { none: {} },
      },
    });
    if (deleted.count !== 1) {
      throw new ConflictException(
        "Die Gruppe wurde zwischenzeitlich belegt und kann nicht gelöscht werden.",
      );
    }
    return this.toGroup(group);
  }

  async findMembers(id: string, actor: AuthenticatedUser) {
    await this.assertMayReadMembers(id, actor);
    const memberships = await this.prisma.groupMembership.findMany({
      where: { groupId: id },
      orderBy: { user: { displayName: "asc" } },
      include: membershipWithUser,
    });
    return memberships.map((membership) => this.toMembership(membership));
  }

  /**
   * Liefert nur minimale Profildaten aktiver, noch nicht zugeordneter Benutzer.
   * Die Abfrage folgt derselben gruppengebundenen Grenze wie das Hinzufügen.
   */
  async findMemberCandidates(
    groupId: string,
    query: GroupMemberCandidatesQuery,
    actor: AuthenticatedUser,
  ) {
    await this.assertMayManageMembers(groupId, actor);
    const normalizedQuery = query.q?.trim();
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        groupMemberships: { none: { groupId, hasLocalGrant: true } },
        ...(normalizedQuery
          ? {
              OR: [
                {
                  displayName: {
                    contains: normalizedQuery,
                    mode: "insensitive" as const,
                  },
                },
                {
                  username: {
                    contains: normalizedQuery,
                    mode: "insensitive" as const,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      take: 100,
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
      },
    });
  }

  async addMember(
    groupId: string,
    input: AddGroupMemberInput,
    actor: AuthenticatedUser,
  ) {
    const authority = await this.assertMayManageMembers(groupId, actor);
    if (authority === "GROUP_MANAGER" && input.role === "MANAGER") {
      throw new ForbiddenException(
        "Gruppenverwalter dürfen keine weiteren Verwalter ernennen.",
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, isActive: true },
    });
    if (!user) {
      throw new NotFoundException("Benutzer nicht gefunden.");
    }
    if (!user.isActive) {
      throw new BadRequestException(
        "Deaktivierte Benutzer können keiner Gruppe hinzugefügt werden.",
      );
    }

    try {
      const membership = await this.prisma.groupMembership.create({
        data: {
          groupId,
          userId: input.userId,
          role: input.role,
        },
        include: membershipWithUser,
      });
      return this.toMembership(membership);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const upgraded = await this.prisma.groupMembership.updateMany({
          where: {
            groupId,
            userId: input.userId,
            hasLocalGrant: false,
          },
          data: {
            hasLocalGrant: true,
            role: input.role,
          },
        });
        if (upgraded.count === 1) {
          return this.toMembership(
            await this.findMembership(groupId, input.userId),
          );
        }
        throw new ConflictException(
          "Der Benutzer ist bereits Mitglied dieser Gruppe.",
        );
      }
      throw error;
    }
  }

  /** Rollenwechsel innerhalb einer Gruppe bleibt globaler Verwaltung vorbehalten. */
  async updateMember(
    groupId: string,
    userId: string,
    input: UpdateGroupMemberInput,
    actor: AuthenticatedUser,
  ) {
    const authority = await this.assertMayManageMembers(groupId, actor);
    if (authority !== "GLOBAL") {
      throw new ForbiddenException(
        "Nur die globale Gruppenverwaltung darf Gruppenverwalter ernennen oder abberufen.",
      );
    }

    const existing = await this.findMembership(groupId, userId);
    if (!existing.hasLocalGrant) {
      throw new ConflictException(
        "Eine ausschließlich extern verwaltete Mitgliedschaft kann lokal keine Verwalterrolle erhalten.",
      );
    }
    const membership = await this.prisma.groupMembership.update({
      where: { groupId_userId: { groupId, userId } },
      data: { role: input.role },
      include: membershipWithUser,
    });
    return this.toMembership(membership);
  }

  async removeMember(
    groupId: string,
    userId: string,
    actor: AuthenticatedUser,
  ) {
    const authority = await this.assertMayManageMembers(groupId, actor);
    const existing = await this.findMembership(groupId, userId);
    if (authority === "GROUP_MANAGER" && existing.role === "MANAGER") {
      throw new ForbiddenException(
        "Gruppenverwalter dürfen keine Verwalter-Mitgliedschaft entfernen.",
      );
    }
    if (!existing.hasLocalGrant) {
      throw new ConflictException(
        "Die Mitgliedschaft wird ausschließlich durch einen Identity Provider verwaltet.",
      );
    }

    if (existing._count.externalGrants > 0) {
      await this.prisma.groupMembership.update({
        where: { groupId_userId: { groupId, userId } },
        data: { hasLocalGrant: false, role: "MEMBER" },
      });
    } else {
      await this.prisma.groupMembership.delete({
        where: { groupId_userId: { groupId, userId } },
      });
    }
    return this.toMembership(existing);
  }

  private async assertMayReadMembers(
    groupId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.assertGroupExists(groupId);
    const mayRead =
      (await this.permissions.isAllowed(actor, "groups", "read")) ||
      (await this.permissions.isAllowed(actor, "groups", "manage_members"));
    if (mayRead) return;

    if (
      actor.authenticationMethod !== "apiKey" &&
      (await this.isGroupManager(groupId, actor.id))
    ) {
      return;
    }
    throw new ForbiddenException(
      "Du darfst die Mitglieder dieser Gruppe nicht anzeigen.",
    );
  }

  private async assertMayManageMembers(
    groupId: string,
    actor: AuthenticatedUser,
  ): Promise<MembershipAuthority> {
    await this.assertGroupExists(groupId);
    if (
      await this.permissions.isAllowed(actor, "groups", "manage_members")
    ) {
      return "GLOBAL";
    }
    if (
      actor.authenticationMethod !== "apiKey" &&
      (await this.isGroupManager(groupId, actor.id))
    ) {
      return "GROUP_MANAGER";
    }
    throw new ForbiddenException(
      "Du darfst die Mitglieder dieser Gruppe nicht verwalten.",
    );
  }

  private async isGroupManager(
    groupId: string,
    userId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true, hasLocalGrant: true },
    });
    return (
      membership?.role === "MANAGER" && membership.hasLocalGrant !== false
    );
  }

  private async findGroup(id: string): Promise<GroupWithCount> {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: groupWithCount,
    });
    if (!group) {
      throw new NotFoundException("Gruppe nicht gefunden.");
    }
    return group;
  }

  private async assertGroupExists(id: string): Promise<void> {
    const group = await this.prisma.group.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException("Gruppe nicht gefunden.");
    }
  }

  private async findMembership(
    groupId: string,
    userId: string,
  ): Promise<MembershipWithUser> {
    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: membershipWithUser,
    });
    if (!membership) {
      throw new NotFoundException(
        "Der Benutzer ist kein Mitglied dieser Gruppe.",
      );
    }
    return membership;
  }

  private async assertNameAvailable(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.prisma.group.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        id: excludeId ? { not: excludeId } : undefined,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException("Eine Gruppe mit diesem Namen existiert bereits.");
    }
  }

  private async generateUniqueSlug(
    name: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(name, { lower: true, strict: true }) || "gruppe";
    let candidate = base;
    let suffix = 1;

    while (true) {
      const existing = await this.prisma.group.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing || existing.id === excludeId) {
        return candidate;
      }
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      throw new ConflictException("Name oder Slug der Gruppe ist bereits vergeben.");
    }
    throw error;
  }

  private toGroup(group: GroupWithCount) {
    return {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      isSystem: group.isSystem,
      memberCount: group._count.memberships,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  private toMembership(membership: MembershipWithUser) {
    return {
      id: membership.id,
      groupId: membership.groupId,
      userId: membership.userId,
      role: membership.role as GroupMembershipRole,
      hasLocalGrant: membership.hasLocalGrant,
      externalGrantCount: membership._count.externalGrants,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString(),
      user: membership.user,
    };
  }
}

function isUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
