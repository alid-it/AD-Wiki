import { RegisterSchema, type RegisterInput } from "@ad-wiki/shared-types";

/**
 * DTO für die Registrierung.
 * Validierung über das zentrale Zod-Schema aus @ad-wiki/shared-types
 * (Single Source of Truth) – prüft u. a. die Übereinstimmung der Passwörter.
 */
export { RegisterSchema };
export type RegisterDto = RegisterInput;
