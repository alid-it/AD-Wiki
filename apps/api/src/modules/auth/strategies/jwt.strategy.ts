import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { getJwtSecret } from "@/common/config/jwt.config";
import { AuthService } from "@/modules/auth/auth.service";
import type { AuthenticatedUser, JwtPayload } from "@/modules/auth/types/jwt-payload";

/**
 * Passport-Strategy für JWT-Access-Tokens.
 * Liest den Token aus dem "Authorization: Bearer <token>"-Header,
 * prüft die Signatur und lädt den zugehörigen User.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  /**
   * Wird nach erfolgreicher Signaturprüfung aufgerufen.
   * Der Rückgabewert landet als `request.user`.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.authService.validateUser(payload);
    if (!user) {
      throw new UnauthorizedException("Benutzer nicht gefunden oder deaktiviert.");
    }
    return user;
  }
}
