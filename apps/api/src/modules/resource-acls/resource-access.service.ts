import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ResourceAclEffect } from "@prisma/client";
import {
  isPermissionSupported,
  type EvaluateResourceAccessInput,
  type ResourceAccessDecision,
  type ResourceAccessReason,
  type ResourceAclTargetRef,
} from "@ad-wiki/shared-types";
import { PermissionService } from "@/modules/auth/permission.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import {
  ResourceTargetService,
  type ResolvedResourceTarget,
  type ResolvedTargetHierarchy,
} from "@/modules/resource-acls/resource-target.service";
import { PrismaService } from "@/prisma/prisma.service";

interface AccessRequest {
  resource: EvaluateResourceAccessInput["resource"];
  action: EvaluateResourceAccessInput["action"];
  targetType: EvaluateResourceAccessInput["targetType"];
  targetId: string;
}

interface BatchAccessRequest {
  resource: EvaluateResourceAccessInput["resource"];
  action: EvaluateResourceAccessInput["action"];
  targetType: EvaluateResourceAccessInput["targetType"];
  targetIds: readonly string[];
}

interface LoadedResourceRule {
  id: string;
  targetKey: string;
  effect: ResourceAclEffect;
  inheritToChildren: boolean;
  userId: string | null;
  groupId: string | null;
}

/** Zentraler, deterministischer Auswerter für globale Rechte und Ressourcen-ACLs. */
@Injectable()
export class ResourceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly targets: ResourceTargetService,
  ) {}

  async evaluate(
    actor: AuthenticatedUser,
    request: AccessRequest,
  ): Promise<ResourceAccessDecision> {
    if (!isPermissionSupported(request.resource, request.action)) {
      throw new BadRequestException(
        "Diese Kombination aus Ressource und Aktion wird nicht unterstützt.",
      );
    }

    const globalAllowed = await this.permissions.isAllowed(
      actor,
      request.resource,
      request.action,
    );
    if (!globalAllowed) {
      return this.decision(false, "global_denied", false, null, null, [], []);
    }

    const hierarchy = await this.targets.resolveHierarchy(
      request.targetType,
      request.targetId,
    );
    this.targets.assertResourceMatches(hierarchy.path[0], request.resource);
    this.targets.assertActionSupported(hierarchy.path[0], request.action);

    if (hierarchy.personalNote) {
      return this.evaluatePersonalNote(actor, request, hierarchy);
    }

    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId: actor.id },
      select: { groupId: true },
      orderBy: { groupId: "asc" },
    });
    const groupIds = memberships.map((membership) => membership.groupId);
    const targetKeys = hierarchy.path.map((target) => target.key);
    const recipients = [
      { userId: actor.id },
      ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
    ];

    const [entries, boundaries] = await Promise.all([
      this.prisma.resourceAclEntry.findMany({
        where: {
          action: request.action,
          targetKey: { in: targetKeys },
          OR: recipients,
        },
        select: {
          id: true,
          targetKey: true,
          effect: true,
          inheritToChildren: true,
          userId: true,
          groupId: true,
        },
      }),
      this.prisma.resourceAclBoundary.findMany({
        where: {
          action: request.action,
          targetKey: { in: targetKeys },
        },
        select: { targetKey: true },
      }),
    ]);
    const boundaryKeys = new Set(
      boundaries.map((boundary) => boundary.targetKey),
    );

    for (const [index, target] of hierarchy.path.entries()) {
      const applicable = entries.filter(
        (entry) =>
          entry.targetKey === target.key &&
          (index === 0 || entry.inheritToChildren),
      );
      const userEntry = applicable.find((entry) => entry.userId === actor.id);
      if (userEntry) {
        const allowed = userEntry.effect === ResourceAclEffect.ALLOW;
        return this.decision(
          allowed,
          this.ruleReason(index, "user", allowed),
          true,
          userEntry.id,
          target,
          hierarchy.path,
          groupIds,
        );
      }

      const groupEntries = applicable.filter(
        (entry) => entry.groupId && groupIds.includes(entry.groupId),
      );
      const groupDeny = groupEntries.find(
        (entry) => entry.effect === ResourceAclEffect.DENY,
      );
      const groupRule = groupDeny ?? groupEntries[0];
      if (groupRule) {
        const allowed = groupRule.effect === ResourceAclEffect.ALLOW;
        return this.decision(
          allowed,
          this.ruleReason(index, "group", allowed),
          true,
          groupRule.id,
          target,
          hierarchy.path,
          groupIds,
        );
      }

      if (boundaryKeys.has(target.key)) {
        return this.visibilityDecision(
          hierarchy,
          target,
          groupIds,
          true,
        );
      }
    }

    return this.visibilityDecision(hierarchy, null, groupIds, false);
  }

  /**
   * Wertet beliebig viele gleichartige Ziele mit konstant vielen Abfragen aus.
   * Die Rückgabemap enthält nur tatsächlich vorhandene Ziele.
   */
  async evaluateMany(
    actor: AuthenticatedUser,
    request: BatchAccessRequest,
  ): Promise<Map<string, ResourceAccessDecision>> {
    const uniqueIds = [...new Set(request.targetIds)];
    if (!isPermissionSupported(request.resource, request.action)) {
      throw new BadRequestException(
        "Diese Kombination aus Ressource und Aktion wird nicht unterstützt.",
      );
    }
    if (uniqueIds.length === 0) return new Map();

    const globalAllowed = await this.permissions.isAllowed(
      actor,
      request.resource,
      request.action,
    );
    if (!globalAllowed) {
      return new Map(
        uniqueIds.map((id) => [
          id,
          this.decision(
            false,
            "global_denied",
            false,
            null,
            null,
            [],
            [],
          ),
        ]),
      );
    }

    const hierarchies = await this.targets.resolveHierarchies(
      request.targetType,
      uniqueIds,
    );
    for (const hierarchy of hierarchies.values()) {
      this.targets.assertResourceMatches(hierarchy.path[0], request.resource);
      this.targets.assertActionSupported(hierarchy.path[0], request.action);
    }

    const memberships = await this.prisma.groupMembership.findMany({
      where: { userId: actor.id },
      select: { groupId: true },
      orderBy: { groupId: "asc" },
    });
    const groupIds = memberships.map((membership) => membership.groupId);
    const targetKeys = [
      ...new Set(
        [...hierarchies.values()].flatMap((hierarchy) =>
          hierarchy.path.map((target) => target.key),
        ),
      ),
    ];
    const recipients = [
      { userId: actor.id },
      ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
    ];
    const [entries, boundaries] = await Promise.all([
      this.prisma.resourceAclEntry.findMany({
        where: {
          action: request.action,
          targetKey: { in: targetKeys },
          OR: recipients,
        },
        select: {
          id: true,
          targetKey: true,
          effect: true,
          inheritToChildren: true,
          userId: true,
          groupId: true,
        },
      }),
      this.prisma.resourceAclBoundary.findMany({
        where: {
          action: request.action,
          targetKey: { in: targetKeys },
        },
        select: { targetKey: true },
      }),
    ]);
    const boundaryKeys = new Set(
      boundaries.map((boundary) => boundary.targetKey),
    );
    const decisions = new Map<string, ResourceAccessDecision>();
    for (const [id, hierarchy] of hierarchies) {
      decisions.set(
        id,
        this.evaluateLoadedHierarchy(
          actor,
          request.action,
          hierarchy,
          groupIds,
          entries,
          boundaryKeys,
        ),
      );
    }
    return decisions;
  }

  async allowedTargetIds(
    actor: AuthenticatedUser,
    request: BatchAccessRequest,
  ): Promise<string[]> {
    const decisions = await this.evaluateMany(actor, request);
    return request.targetIds.filter(
      (id) => decisions.get(id)?.allowed === true,
    );
  }

  /** Verbirgt verweigerte Einzelziele wie nicht vorhandene Inhalte. */
  async assertAllowed(
    actor: AuthenticatedUser,
    request: AccessRequest,
    notFoundMessage = "Inhalt wurde nicht gefunden.",
  ): Promise<ResourceAccessDecision> {
    const decision = await this.evaluate(actor, request);
    if (!decision.allowed) {
      throw new NotFoundException(notFoundMessage);
    }
    return decision;
  }

  /** Vorschau für Administratoren; API-Key-Grenzen gelten nur für den Akteur selbst. */
  async evaluateForUser(
    input: EvaluateResourceAccessInput,
  ): Promise<ResourceAccessDecision> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        roleId: true,
        role: { select: { name: true } },
        isActive: true,
        isProtected: true,
      },
    });
    if (!user || !user.isActive) {
      throw new NotFoundException("Aktiver Benutzer wurde nicht gefunden.");
    }
    return this.evaluate(
      {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        roleId: user.roleId,
        role: user.role.name,
        isActive: user.isActive,
        isProtected: user.isProtected,
        authenticationMethod: "jwt",
      },
      input,
    );
  }

  private evaluatePersonalNote(
    actor: AuthenticatedUser,
    request: AccessRequest,
    hierarchy: ResolvedTargetHierarchy,
  ): ResourceAccessDecision {
    const personal = hierarchy.personalNote;
    if (!personal) {
      throw new Error("Persönliche Notizdaten fehlen.");
    }
    if (personal.ownerId === actor.id) {
      return this.decision(
        true,
        "personal_owner",
        true,
        null,
        hierarchy.path[0],
        hierarchy.path,
        [],
      );
    }
    const share = personal.shares.find((entry) => entry.userId === actor.id);
    const sharedAction =
      request.action === "read" ||
      (request.action === "update" && share?.permission === "EDIT");
    if (share && sharedAction) {
      return this.decision(
        true,
        "personal_share",
        true,
        null,
        hierarchy.path[0],
        hierarchy.path,
        [],
      );
    }
    return this.decision(
      false,
      "personal_denied",
      true,
      null,
      hierarchy.path[0],
      hierarchy.path,
      [],
    );
  }

  private evaluateLoadedHierarchy(
    actor: AuthenticatedUser,
    action: AccessRequest["action"],
    hierarchy: ResolvedTargetHierarchy,
    groupIds: string[],
    entries: LoadedResourceRule[],
    boundaryKeys: Set<string>,
  ): ResourceAccessDecision {
    if (hierarchy.personalNote) {
      return this.evaluatePersonalNote(
        actor,
        {
          resource: "notes",
          action,
          targetType: "note",
          targetId: hierarchy.path[0].id,
        },
        hierarchy,
      );
    }

    for (const [index, target] of hierarchy.path.entries()) {
      const applicable = entries.filter(
        (entry) =>
          entry.targetKey === target.key &&
          (index === 0 || entry.inheritToChildren),
      );
      const userEntry = applicable.find((entry) => entry.userId === actor.id);
      if (userEntry) {
        const allowed = userEntry.effect === ResourceAclEffect.ALLOW;
        return this.decision(
          allowed,
          this.ruleReason(index, "user", allowed),
          true,
          userEntry.id,
          target,
          hierarchy.path,
          groupIds,
        );
      }
      const groupEntries = applicable.filter(
        (entry) => entry.groupId && groupIds.includes(entry.groupId),
      );
      const groupRule =
        groupEntries.find(
          (entry) => entry.effect === ResourceAclEffect.DENY,
        ) ?? groupEntries[0];
      if (groupRule) {
        const allowed = groupRule.effect === ResourceAclEffect.ALLOW;
        return this.decision(
          allowed,
          this.ruleReason(index, "group", allowed),
          true,
          groupRule.id,
          target,
          hierarchy.path,
          groupIds,
        );
      }
      if (boundaryKeys.has(target.key)) {
        return this.visibilityDecision(
          hierarchy,
          target,
          groupIds,
          true,
        );
      }
    }
    return this.visibilityDecision(hierarchy, null, groupIds, false);
  }

  private visibilityDecision(
    hierarchy: ResolvedTargetHierarchy,
    boundaryTarget: ResolvedResourceTarget | null,
    groupIds: string[],
    boundary: boolean,
  ): ResourceAccessDecision {
    const allowed = hierarchy.spaceVisibility === "open";
    const reason: ResourceAccessReason = boundary
      ? allowed
        ? "inheritance_boundary_open"
        : "inheritance_boundary_restricted"
      : allowed
        ? "space_open"
        : "space_restricted";
    const spaceTarget =
      hierarchy.path.find((target) => target.type === "space") ?? null;
    return this.decision(
      allowed,
      reason,
      true,
      null,
      boundaryTarget ?? spaceTarget,
      hierarchy.path,
      groupIds,
    );
  }

  private ruleReason(
    pathIndex: number,
    recipient: "user" | "group",
    allowed: boolean,
  ): ResourceAccessReason {
    const location = pathIndex === 0 ? "direct" : "inherited";
    const effect = allowed ? "allow" : "deny";
    return `${location}_${recipient}_${effect}` as ResourceAccessReason;
  }

  private decision(
    allowed: boolean,
    reason: ResourceAccessReason,
    globalAllowed: boolean,
    ruleId: string | null,
    sourceTarget: ResourceAclTargetRef | null,
    evaluatedPath: ResourceAclTargetRef[],
    groupIds: string[],
  ): ResourceAccessDecision {
    return {
      allowed,
      reason,
      globalAllowed,
      ruleId,
      sourceTarget,
      evaluatedPath: evaluatedPath.map(({ type, id, label }) => ({
        type,
        id,
        label,
      })),
      groupIds,
    };
  }
}
