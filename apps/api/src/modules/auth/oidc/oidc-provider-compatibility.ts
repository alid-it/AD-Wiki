import { IdentityProviderType } from "@prisma/client";

/**
 * Microsoft Entra unterstützt PKCE S256, veröffentlicht das optionale
 * Discovery-Merkmal aber nicht zuverlässig. Ein vorhandenes Methoden-Array
 * bleibt für alle Provider verbindlich.
 */
export function supportsPkceS256(
  providerType: IdentityProviderType,
  advertisedMethods: unknown,
): boolean {
  if (advertisedMethods === undefined) {
    return providerType === IdentityProviderType.MICROSOFT_ENTRA;
  }
  return (
    Array.isArray(advertisedMethods) &&
    advertisedMethods.includes("S256")
  );
}

/**
 * Entra stellt email_verified in Workforce-ID-Tokens üblicherweise nicht
 * bereit. Ein explizit negativer Wert darf dennoch nie akzeptiert werden.
 */
export function acceptsEmailVerificationClaim(
  providerType: IdentityProviderType,
  verificationClaim: unknown,
): boolean {
  if (providerType === IdentityProviderType.MICROSOFT_ENTRA) {
    return verificationClaim === undefined || verificationClaim === true;
  }
  return verificationClaim === true;
}
