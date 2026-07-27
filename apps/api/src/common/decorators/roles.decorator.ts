import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "@ad-wiki/shared-types";

/** Metadaten-Schlüssel, unter dem die erforderlichen Rollen abgelegt werden. */
export const ROLES_KEY = "roles";

/**
 * Beschränkt eine Route auf bestimmte Rollen.
 * Muss zusammen mit `JwtAuthGuard` und `RolesGuard` verwendet werden.
 *
 * Beispiel: `@Roles("admin")`
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
