import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from "@/modules/auth/decorators/require-permission.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import {
  PermissionService,
  type PermissionCache,
} from "@/modules/auth/permission.service";

/** Erzwingt globale Rollenrechte mit individuellen Overrides und API-Key-Grenzen. */
@Injectable()
export class AclGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata =
      this.reflector.getAllAndOverride<
        RequiredPermission | RequiredPermission[] | undefined
      >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!metadata) return true;

    const requiredPermissions = Array.isArray(metadata) ? metadata : [metadata];
    const request = context
      .switchToHttp()
      .getRequest<
        Request & {
          user?: AuthenticatedUser;
          permissionCache?: PermissionCache;
        }
      >();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException("Für diese Aktion fehlt die Berechtigung.");
    }

    const cache =
      request.permissionCache ?? (request.permissionCache = new Map());

    for (const required of requiredPermissions) {
      const allowed = await this.permissions.isAllowed(
        user,
        required.resource,
        required.action,
        cache,
      );
      if (!allowed) {
        throw new ForbiddenException("Für diese Aktion fehlt die Berechtigung.");
      }
    }

    return true;
  }
}
