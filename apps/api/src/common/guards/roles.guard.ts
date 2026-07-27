import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { UserRole } from "@ad-wiki/shared-types";
import { ROLES_KEY } from "@/common/decorators/roles.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";

/**
 * Prüft, ob der authentifizierte User eine der per `@Roles(...)` geforderten
 * Rollen besitzt. Setzt einen bereits gesetzten `request.user` voraus – daher
 * immer NACH dem `JwtAuthGuard` einsetzen: `@UseGuards(JwtAuthGuard, RolesGuard)`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Keine Rollen gefordert → Route ist (abgesehen vom JWT) frei.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (
      !user ||
      !required.includes(user.role) ||
      (user.apiKeyPermissions !== undefined && user.apiKeyPermissions !== null)
    ) {
      throw new ForbiddenException("Für diese Aktion fehlt die Berechtigung.");
    }
    return true;
  }
}
