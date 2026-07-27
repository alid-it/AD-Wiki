import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type Role } from "@prisma/client";
import { PrismaService } from "@/prisma/prisma.service";

const effectiveRoleUserSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  roleId: true,
  isActive: true,
  isProtected: true,
  hasLocalPassword: true,
  role: true,
  externalIdentities: {
    select: {
      externalRoleGrant: {
        select: {
          role: true,
          roleMapping: {
            select: {
              id: true,
              priority: true,
              providerId: true,
              provider: { select: { displayOrder: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type EffectiveRoleUserPayload = Prisma.UserGetPayload<{
  select: typeof effectiveRoleUserSelect;
}>;

export interface EffectiveAuthUserRecord {
  id: string;
  email: string;
  username: string;
  displayName: string;
  roleId: string;
  isActive: boolean;
  isProtected: boolean;
  hasLocalPassword: boolean;
  role: Role;
}

/**
 * Ermittelt die wirksame Anwendungsrolle, ohne die lokal gepflegte Rolle am
 * Benutzer zu überschreiben. Niedrigere Zahlen besitzen die höhere Priorität.
 */
@Injectable()
export class EffectiveRoleService {
  private readonly logger = new Logger(EffectiveRoleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveUser(userId: string): Promise<EffectiveAuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: effectiveRoleUserSelect,
    });
    return user ? this.withEffectiveRole(user) : null;
  }

  async resolveUserInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<EffectiveAuthUserRecord | null> {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: effectiveRoleUserSelect,
    });
    return user ? this.withEffectiveRole(user) : null;
  }

  async resolveRole(userId: string): Promise<Role | null> {
    return (await this.resolveUser(userId))?.role ?? null;
  }

  private withEffectiveRole(
    user: EffectiveRoleUserPayload,
  ): EffectiveAuthUserRecord {
    const grants = user.externalIdentities
      .flatMap((identity) =>
        identity.externalRoleGrant ? [identity.externalRoleGrant] : [],
      )
      .sort(
        (left, right) =>
          left.roleMapping.priority - right.roleMapping.priority ||
          left.roleMapping.provider.displayOrder -
            right.roleMapping.provider.displayOrder ||
          left.roleMapping.providerId.localeCompare(
            right.roleMapping.providerId,
          ) ||
          left.roleMapping.id.localeCompare(right.roleMapping.id),
      );
    const first = grants[0];
    const conflictingTopPriority =
      first !== undefined &&
      grants.some(
        (grant, index) =>
          index > 0 &&
          grant.roleMapping.priority === first.roleMapping.priority,
      );
    if (conflictingTopPriority) {
      // Bei historisch inkonsistenten Daten gilt sicherheitshalber die lokale Rolle.
      this.logger.warn(
        "Gleichrangige externe Rollen-Grants erkannt; lokale Rolle bleibt wirksam.",
      );
    }
    const role = !conflictingTopPriority && first ? first.role : user.role;
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      roleId: role.id,
      isActive: user.isActive,
      isProtected: user.isProtected,
      hasLocalPassword: user.hasLocalPassword,
      role,
    };
  }
}
