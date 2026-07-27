import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { firstValueFrom, isObservable } from "rxjs";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { MediaService } from "@/modules/media/media.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";

/** Erlaubt einen gueltigen JWT oder ein Medium einer oeffentlichen Seite. */
@Injectable()
export class MediaFileGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly mediaService: MediaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization?.startsWith("Bearer ")) {
      const result = this.jwt.canActivate(context);
      const authenticated = isObservable(result)
        ? await firstValueFrom(result)
        : await result;
      if (!authenticated) return false;
      const user = request.user as AuthenticatedUser | undefined;
      const id = request.params.id;
      if (
        !user ||
        typeof id !== "string" ||
        !(await this.mediaService.isAccessibleTo(id, user))
      ) {
        throw new UnauthorizedException(
          "Fuer dieses Medium fehlt die Berechtigung.",
        );
      }
      return true;
    }

    const id = request.params.id;
    if (typeof id === "string" && await this.mediaService.isPubliclyAccessible(id)) {
      return true;
    }
    throw new UnauthorizedException("Fuer dieses Medium ist eine Anmeldung erforderlich.");
  }
}
