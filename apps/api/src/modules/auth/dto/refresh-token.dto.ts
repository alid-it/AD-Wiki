import { RefreshTokenSchema, type RefreshTokenInput } from "@ad-wiki/shared-types";

/**
 * DTO zum Erneuern des Access-Tokens.
 * Erwartet den zuvor ausgestellten Refresh-Token.
 */
export { RefreshTokenSchema };
export type RefreshTokenDto = RefreshTokenInput;
