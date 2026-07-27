import { Injectable } from "@nestjs/common";
import type { Action, Resource } from "@ad-wiki/shared-types";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { PrismaService } from "@/prisma/prisma.service";

export type PermissionCache = Map<string, boolean>;

/**
 * Wertet globale Rollenrechte, individuelle Overrides und API-Key-Grenzen aus.
 * Ressourcen-ACLs werden ab Phase 14C nach dieser globalen Obergrenze geprüft.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async isAllowed(
    user: AuthenticatedUser,
    resource: Resource,
    action: Action,
    cache?: PermissionCache,
  ): Promise<boolean> {
    if (user.isProtected && user.authenticationMethod !== "apiKey") {
      return true;
    }

    if (
      user.apiKeyPermissions !== undefined &&
      user.apiKeyPermissions !== null &&
      !user.apiKeyPermissions.some(
        (permission) =>
          permission.resource === resource && permission.action === action,
      )
    ) {
      return false;
    }

    const key = `${resource}:${action}`;
    const cached = cache?.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const [override, acl] = await Promise.all([
      this.prisma.userPermission.findUnique({
        where: {
          userId_resource_action: {
            userId: user.id,
            resource,
            action,
          },
        },
        select: { allowed: true },
      }),
      this.prisma.acl.findUnique({
        where: {
          roleId_resource_action: {
            roleId: user.roleId,
            resource,
            action,
          },
        },
        select: { allowed: true },
      }),
    ]);

    const allowed = override?.allowed ?? acl?.allowed ?? false;
    cache?.set(key, allowed);
    return allowed;
  }
}
