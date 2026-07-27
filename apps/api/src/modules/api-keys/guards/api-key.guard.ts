import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeysService } from "@/modules/api-keys/api-keys.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { MonitoringService } from "@/health/monitoring.service";

/** Authentifiziert einen Request ueber den X-API-Key Header. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly monitoring: MonitoringService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const rawKey = request.header("x-api-key")?.trim();
    if (!rawKey) {
      this.monitoring.recordApiKeyAuthentication(false);
      throw new UnauthorizedException("Ein gueltiger API Key ist erforderlich.");
    }

    const verified = await this.apiKeys.verify(rawKey);
    if (!verified) {
      this.monitoring.recordApiKeyAuthentication(false);
      throw new UnauthorizedException("Der API Key ist ungueltig oder nicht mehr aktiv.");
    }
    this.monitoring.recordApiKeyAuthentication(true);
    request.user = verified.user;
    return true;
  }
}
