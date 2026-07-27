import type { ApiKeyPermission, UserRole } from "@ad-wiki/shared-types";

/**
 * Nutzdaten (Payload) eines Access-Tokens.
 * Enthält bewusst nur unkritische Identifikatoren – niemals das Passwort.
 */
export interface JwtPayload {
  /** UUID des Users. */
  userId: string;
  /** E-Mail des Users. */
  email: string;
  /** Rollenname des Users (z. B. "admin", "editor", "viewer"). */
  role: UserRole;
  /** Persistente ID der zugewiesenen Rolle. */
  roleId: string;
  /** Trennt Access- und Refresh-Tokens trotz gemeinsamem Signatur-Secret. */
  tokenType?: "access" | "refresh";
  /** Verknüpft neue Refresh-Tokens eindeutig mit ihrem Session-Datensatz. */
  tokenId?: string;
  /** Von JWT gesetzter Ablaufzeitpunkt in Unix-Sekunden. */
  exp?: number;
}

/**
 * Der auf `request.user` abgelegte, bereinigte User.
 * Wird von der JWT-Strategy nach erfolgreicher Validierung gesetzt.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  roleId: string;
  role: UserRole;
  isActive: boolean;
  hasLocalPassword?: boolean;
  /** Kennzeichnet das beim Produktions-Setup angelegte Notfallkonto. */
  isProtected?: boolean;
  authenticationMethod?: "jwt" | "apiKey";
  apiKeyId?: string;
  /** null bedeutet uneingeschraenkt; ein Array ist eine explizite Allowlist. */
  apiKeyPermissions?: ApiKeyPermission[] | null;
}
