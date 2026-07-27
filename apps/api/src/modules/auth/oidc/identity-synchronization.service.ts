import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import {
  IdentityProviderRoleMappingSource,
  IdentityProviderSyncMode,
  Prisma,
} from "@prisma/client";
import type {
  IdentitySyncGroupChange,
  IdentitySyncPreview,
  IdentitySyncRoleChange,
} from "@ad-wiki/shared-types";
import type { RequestContext } from "@/modules/auth/auth.service";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { PrismaService } from "@/prisma/prisma.service";

const MAX_SYNC_VALUES = 500;
const MAX_SYNC_VALUE_LENGTH = 2_000;
const PRIVILEGED_ROLE_RESOURCES = new Set([
  "users",
  "roles",
  "acls",
  "user_permissions",
  "groups",
  "settings",
  "audit_logs",
  "api_keys",
  "smtp",
  "system_info",
  "backups",
  "resource_acls",
]);

const syncIdentityInclude = {
  provider: {
    include: {
      groupMappings: { include: { group: true } },
      roleMappings: {
        include: {
          role: {
            include: {
              acls: {
                where: { allowed: true },
                select: { resource: true },
              },
            },
          },
        },
      },
    },
  },
  user: {
    select: {
      id: true,
      externalIdentities: {
        select: {
          id: true,
          externalRoleGrant: {
            select: {
              externalIdentityId: true,
              roleMapping: { select: { priority: true } },
            },
          },
        },
      },
    },
  },
  groupMembershipGrants: {
    include: {
      membership: true,
      groupMapping: { include: { group: true } },
    },
  },
  externalRoleGrant: {
    include: {
      role: true,
      roleMapping: true,
    },
  },
} satisfies Prisma.ExternalIdentityInclude;

type SyncIdentity = Prisma.ExternalIdentityGetPayload<{
  include: typeof syncIdentityInclude;
}>;

type NormalizedClaims = {
  groups: string[];
  roles: string[];
};

export type IdentitySyncErrorCode =
  | "group_claim_invalid"
  | "group_mapping_ambiguous"
  | "role_claim_invalid"
  | "role_priority_conflict"
  | "admin_role_mapping_disabled";

export class IdentitySyncError extends Error {
  constructor(readonly code: IdentitySyncErrorCode) {
    super(code);
    this.name = "IdentitySyncError";
  }
}

/**
 * Gleicht ausschließlich Grants einer externen Identität ab. Lokale Gruppen-
 * vergaben und Grants anderer Provider werden weder verändert noch gelöscht.
 */
@Injectable()
export class IdentitySynchronizationService {
  private readonly logger = new Logger(IdentitySynchronizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async preview(
    providerId: string,
    externalIdentityId: string,
    claims: Record<string, unknown>,
  ): Promise<IdentitySyncPreview> {
    const identity = await this.findIdentity(providerId, externalIdentityId);
    return this.buildPreview(identity, normalizeProviderClaims(identity, claims));
  }

  async synchronize(
    externalIdentityId: string,
    claims: Record<string, unknown>,
    context: RequestContext = {},
  ): Promise<IdentitySyncPreview> {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { id: externalIdentityId },
      include: syncIdentityInclude,
    });
    if (!identity) {
      throw new NotFoundException("Externe Identität nicht gefunden.");
    }
    let normalizedClaims: NormalizedClaims;
    try {
      normalizedClaims = normalizeProviderClaims(identity, claims);
    } catch (error) {
      await this.recordFailure(identity, error, context);
      throw error;
    }
    return this.apply(identity, normalizedClaims, context);
  }

  /** Wertet bei einer internen Session-Erneuerung den letzten geprüften Snapshot erneut aus. */
  async synchronizeStored(
    externalIdentityId: string,
    context: RequestContext = {},
  ): Promise<IdentitySyncPreview> {
    const identity = await this.prisma.externalIdentity.findUnique({
      where: { id: externalIdentityId },
      include: syncIdentityInclude,
    });
    if (!identity) {
      throw new NotFoundException("Externe Identität nicht gefunden.");
    }
    try {
      assertProviderClaimConfiguration(identity);
    } catch (error) {
      await this.recordFailure(identity, error, context);
      throw error;
    }
    return this.apply(
      identity,
      {
        groups: [...identity.lastGroupClaims],
        roles: [...identity.lastRoleClaims],
      },
      context,
    );
  }

  private async apply(
    loadedIdentity: SyncIdentity,
    normalizedClaims: NormalizedClaims,
    context: RequestContext,
  ): Promise<IdentitySyncPreview> {
    try {
      const result = await this.prisma.$transaction(
        async (transaction) => {
          const identity = await transaction.externalIdentity.findUnique({
            where: { id: loadedIdentity.id },
            include: syncIdentityInclude,
          });
          if (!identity) {
            throw new NotFoundException("Externe Identität nicht gefunden.");
          }
          const preview = this.buildPreview(identity, normalizedClaims);
          const removedMembershipIds = identity.groupMembershipGrants
            .filter((grant) =>
              preview.groups.remove.some(
                (change) => change.mappingId === grant.groupMappingId,
              ),
            )
            .map((grant) => grant.membershipId);

          for (const change of preview.groups.add) {
            let membership = await transaction.groupMembership.findUnique({
              where: {
                groupId_userId: {
                  groupId: change.groupId,
                  userId: identity.userId,
                },
              },
              select: { id: true },
            });
            membership ??= await transaction.groupMembership.create({
              data: {
                groupId: change.groupId,
                userId: identity.userId,
                role: "MEMBER",
                hasLocalGrant: false,
              },
              select: { id: true },
            });
            await transaction.externalGroupMembershipGrant.create({
              data: {
                externalIdentityId: identity.id,
                groupMappingId: change.mappingId,
                membershipId: membership.id,
              },
            });
          }

          if (preview.groups.remove.length > 0) {
            await transaction.externalGroupMembershipGrant.deleteMany({
              where: {
                externalIdentityId: identity.id,
                groupMappingId: {
                  in: preview.groups.remove.map((change) => change.mappingId),
                },
              },
            });
            await transaction.groupMembership.deleteMany({
              where: {
                id: { in: removedMembershipIds },
                hasLocalGrant: false,
                externalGrants: { none: {} },
              },
            });
          }

          if (preview.role.changed) {
            if (preview.role.next) {
              await transaction.externalRoleGrant.upsert({
                where: { externalIdentityId: identity.id },
                create: {
                  externalIdentityId: identity.id,
                  roleMappingId: preview.role.next.mappingId,
                  roleId: preview.role.next.roleId,
                },
                update: {
                  roleMappingId: preview.role.next.mappingId,
                  roleId: preview.role.next.roleId,
                },
              });
            } else {
              await transaction.externalRoleGrant.deleteMany({
                where: { externalIdentityId: identity.id },
              });
            }
          }

          const now = new Date();
          await transaction.externalIdentity.update({
            where: { id: identity.id },
            data: {
              lastGroupClaims: normalizedClaims.groups,
              lastRoleClaims: normalizedClaims.roles,
              lastGroupSyncAt: now,
              lastSyncErrorCode: null,
            },
          });
          await transaction.auditLog.create({
            data: {
              userId: identity.userId,
              action: "identity.groups_synced",
              resource: "external_identity",
              resourceId: identity.id,
              details: {
                providerId: identity.providerId,
                mode: preview.mode,
                addedGroupIds: preview.groups.add.map((change) => change.groupId),
                removedGroupIds: preview.groups.remove.map(
                  (change) => change.groupId,
                ),
                roleChanged: preview.role.changed,
                nextRoleId: preview.role.next?.roleId ?? null,
              } satisfies Prisma.InputJsonObject,
              ipAddress: context.ipAddress,
            },
          });
          return preview;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (
        result.groups.add.length > 0 ||
        result.groups.remove.length > 0 ||
        result.role.changed
      ) {
        this.notifyPermissionsChanged();
      }
      return result;
    } catch (error) {
      await this.recordFailure(loadedIdentity, error, context);
      throw error;
    }
  }

  private async recordFailure(
    identity: Pick<SyncIdentity, "id" | "userId" | "providerId">,
    error: unknown,
    context: RequestContext,
  ): Promise<void> {
    const code =
      error instanceof IdentitySyncError ? error.code : "sync_failed";
    await this.prisma.externalIdentity.updateMany({
      where: { id: identity.id },
      data: { lastSyncErrorCode: code },
    });
    await this.audit.log(
      identity.userId,
      "identity.sync_failed",
      "external_identity",
      identity.id,
      { providerId: identity.providerId, errorCode: code },
      context.ipAddress,
    );
  }

  private buildPreview(
    identity: SyncIdentity,
    normalizedClaims: NormalizedClaims,
  ): IdentitySyncPreview {
    const targetGroups = new Map<
      string,
      { change: IdentitySyncGroupChange; membershipExists: boolean }
    >();
    const matchedGroupValues = new Set<string>();
    for (const value of normalizedClaims.groups) {
      const matches = identity.provider.groupMappings.filter(
        (mapping) =>
          mapping.externalGroupId === value ||
          mapping.externalGroupPath === value,
      );
      if (matches.length > 1) {
        throw new IdentitySyncError("group_mapping_ambiguous");
      }
      const mapping = matches[0];
      if (!mapping) continue;
      matchedGroupValues.add(value);
      targetGroups.set(mapping.id, {
        change: groupChange(mapping, value),
        membershipExists: identity.groupMembershipGrants.some(
          (grant) => grant.groupMappingId === mapping.id,
        ),
      });
    }

    const add = [...targetGroups.values()]
      .filter((target) => !target.membershipExists)
      .map((target) => target.change);
    const keep = identity.groupMembershipGrants
      .filter(
        (grant) =>
          identity.provider.groupSyncMode ===
            IdentityProviderSyncMode.ADD_ONLY ||
          targetGroups.has(grant.groupMappingId),
      )
      .map((grant) => {
        const target = targetGroups.get(grant.groupMappingId);
        return (
          target?.change ??
          groupChange(
            grant.groupMapping,
            grant.groupMapping.externalGroupPath ??
              grant.groupMapping.externalGroupId,
          )
        );
      });
    const remove =
      identity.provider.groupSyncMode === IdentityProviderSyncMode.MANAGED
        ? identity.groupMembershipGrants
            .filter((grant) => !targetGroups.has(grant.groupMappingId))
            .map((grant) =>
              groupChange(
                grant.groupMapping,
                grant.groupMapping.externalGroupPath ??
                  grant.groupMapping.externalGroupId,
              ),
            )
        : [];

    const matchingRoles = identity.provider.roleMappings
      .flatMap((mapping) => {
        const sourceValues =
          mapping.source === IdentityProviderRoleMappingSource.GROUP
            ? normalizedClaims.groups
            : normalizedClaims.roles;
        return sourceValues.includes(mapping.externalValue)
          ? [{ mapping, externalValue: mapping.externalValue }]
          : [];
      })
      .sort(
        (left, right) =>
          left.mapping.priority - right.mapping.priority ||
          left.mapping.id.localeCompare(right.mapping.id),
      );
    const nextMatch = matchingRoles[0];
    if (
      nextMatch &&
      matchingRoles.some(
        (match, index) =>
          index > 0 &&
          match.mapping.priority === nextMatch.mapping.priority,
      )
    ) {
      throw new IdentitySyncError("role_priority_conflict");
    }
    if (
      nextMatch &&
      !identity.provider.allowAdminRoleMapping &&
      isPrivilegedRole(nextMatch.mapping.role)
    ) {
      throw new IdentitySyncError("admin_role_mapping_disabled");
    }
    if (
      nextMatch &&
      identity.user.externalIdentities.some(
        (externalIdentity) =>
          externalIdentity.id !== identity.id &&
          externalIdentity.externalRoleGrant?.roleMapping.priority ===
            nextMatch.mapping.priority,
      )
    ) {
      throw new IdentitySyncError("role_priority_conflict");
    }

    const currentRole = identity.externalRoleGrant
      ? roleChange(
          identity.externalRoleGrant.roleMapping,
          identity.externalRoleGrant.role,
        )
      : null;
    const nextRole = nextMatch
      ? roleChange(nextMatch.mapping, nextMatch.mapping.role)
      : null;
    const roleMappedValues = new Set(
      matchingRoles.map((match) => match.externalValue),
    );
    const roleSourceValues = [
      ...normalizedClaims.groups,
      ...normalizedClaims.roles,
    ];

    return {
      providerId: identity.providerId,
      externalIdentityId: identity.id,
      userId: identity.userId,
      mode: identity.provider.groupSyncMode,
      normalizedClaims,
      groups: {
        add: sortGroupChanges(add),
        keep: sortGroupChanges(keep),
        remove: sortGroupChanges(remove),
        ignoredValues: normalizedClaims.groups.filter(
          (value) => !matchedGroupValues.has(value),
        ),
      },
      role: {
        current: currentRole,
        next: nextRole,
        changed: currentRole?.mappingId !== nextRole?.mappingId,
        ignoredValues: [...new Set(roleSourceValues)].filter(
          (value) => !roleMappedValues.has(value),
        ),
      },
    };
  }

  private async findIdentity(
    providerId: string,
    externalIdentityId: string,
  ): Promise<SyncIdentity> {
    const identity = await this.prisma.externalIdentity.findFirst({
      where: { id: externalIdentityId, providerId },
      include: syncIdentityInclude,
    });
    if (!identity) {
      throw new NotFoundException("Externe Identität nicht gefunden.");
    }
    return identity;
  }

  private notifyPermissionsChanged(): void {
    try {
      this.moduleRef
        ?.get(NotificationService, { strict: false })
        .notifyPermissionsUpdated("groups", "updated");
    } catch (error) {
      this.logger.warn(
        `WebSocket-Signal für Identity-Sync fehlgeschlagen: ${safeErrorName(error)}`,
      );
    }
  }
}

function normalizeProviderClaims(
  identity: SyncIdentity,
  claims: Record<string, unknown>,
): NormalizedClaims {
  assertProviderClaimConfiguration(identity);
  return {
    groups: normalizeClaimValues(
      claims,
      identity.provider.groupClaim,
      "group_claim_invalid",
    ),
    roles: normalizeClaimValues(
      claims,
      identity.provider.roleClaim,
      "role_claim_invalid",
    ),
  };
}

function assertProviderClaimConfiguration(identity: SyncIdentity): void {
  if (
    !identity.provider.groupClaim &&
    (identity.provider.groupMappings.length > 0 ||
      identity.groupMembershipGrants.length > 0)
  ) {
    throw new IdentitySyncError("group_claim_invalid");
  }
  if (
    !identity.provider.roleClaim &&
    identity.provider.roleMappings.some(
      (mapping) => mapping.source === IdentityProviderRoleMappingSource.ROLE,
    )
  ) {
    throw new IdentitySyncError("role_claim_invalid");
  }
}

function normalizeClaimValues(
  claims: Record<string, unknown>,
  path: string | null,
  errorCode: "group_claim_invalid" | "role_claim_invalid",
): string[] {
  if (!path) return [];
  const rawValue = claimAtPath(claims, path);
  const values =
    typeof rawValue === "string"
      ? [rawValue]
      : Array.isArray(rawValue) &&
          rawValue.every((value) => typeof value === "string")
        ? rawValue
        : null;
  if (!values || values.length > MAX_SYNC_VALUES) {
    throw new IdentitySyncError(errorCode);
  }
  const normalized = values.map((value) => value.trim());
  if (
    normalized.some(
      (value) => value.length === 0 || value.length > MAX_SYNC_VALUE_LENGTH,
    )
  ) {
    throw new IdentitySyncError(errorCode);
  }
  return [...new Set(normalized)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function claimAtPath(
  claims: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = claims;
  for (const segment of path.split(".")) {
    if (
      !segment ||
      segment === "__proto__" ||
      segment === "prototype" ||
      segment === "constructor" ||
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function groupChange(
  mapping: SyncIdentity["provider"]["groupMappings"][number],
  externalValue: string,
): IdentitySyncGroupChange {
  return {
    mappingId: mapping.id,
    groupId: mapping.groupId,
    groupName: mapping.group.name,
    externalValue,
  };
}

function roleChange(
  mapping: {
    id: string;
    priority: number;
    source: IdentityProviderRoleMappingSource;
    externalValue: string;
  },
  role: { id: string; name: string },
): IdentitySyncRoleChange {
  return {
    mappingId: mapping.id,
    roleId: role.id,
    roleName: role.name,
    priority: mapping.priority,
    source: mapping.source,
    externalValue: mapping.externalValue,
  };
}

function isPrivilegedRole(role: {
  name: string;
  acls: Array<{ resource: string }>;
}): boolean {
  return (
    role.name.toLowerCase() === "admin" ||
    role.acls.some((entry) => PRIVILEGED_ROLE_RESOURCES.has(entry.resource))
  );
}

function sortGroupChanges(
  changes: IdentitySyncGroupChange[],
): IdentitySyncGroupChange[] {
  return changes.sort(
    (left, right) =>
      left.groupName.localeCompare(right.groupName) ||
      left.groupId.localeCompare(right.groupId),
  );
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
