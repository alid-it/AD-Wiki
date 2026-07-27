import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { firstValueFrom, isObservable } from "rxjs";
import { ApiKeyGuard } from "@/modules/api-keys/guards/api-key.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";

/** Erlaubt wahlweise Browser-JWT oder X-API-Key fuer dieselbe Route. */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly apiKey: ApiKeyGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (typeof request.headers["x-api-key"] === "string") {
      return this.apiKey.canActivate(context);
    }
    if (request.headers.authorization?.startsWith("Bearer ")) {
      const result = this.jwt.canActivate(context);
      if (isObservable(result)) return firstValueFrom(result);
      return await result;
    }
    throw new UnauthorizedException("JWT oder X-API-Key ist erforderlich.");
  }
}
