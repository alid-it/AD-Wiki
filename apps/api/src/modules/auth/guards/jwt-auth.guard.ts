import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Guard zum Schutz von Routen.
 * Prüft den JWT aus dem Authorization-Header und setzt bei Erfolg
 * `request.user`. Bei fehlendem oder ungültigem Token → 401.
 *
 * Verwendung: `@UseGuards(JwtAuthGuard)` an Controller oder Route.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
