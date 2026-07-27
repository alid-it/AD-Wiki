import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";

/**
 * Param-Decorator, der den durch die JWT-Strategy authentifizierten
 * User aus dem Request liefert. Nur in Kombination mit `JwtAuthGuard` sinnvoll.
 *
 * Verwendung: `me(@CurrentUser() user: AuthenticatedUser) { ... }`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    return request.user;
  },
);
