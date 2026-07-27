import { LoginSchema, type LoginInput } from "@ad-wiki/shared-types";

/**
 * DTO für den Login.
 * Validierung über das zentrale Zod-Schema aus @ad-wiki/shared-types
 * (Single Source of Truth) – keine eigene Duplizierung der Regeln.
 */
export { LoginSchema };
export type LoginDto = LoginInput;
