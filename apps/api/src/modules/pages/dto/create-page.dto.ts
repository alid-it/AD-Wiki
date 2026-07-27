import { CreatePageSchema, type CreatePageInput } from "@ad-wiki/shared-types";

/**
 * DTO zum Erstellen einer Seite oder eines Ordners.
 * Validierung über das zentrale Zod-Schema aus @ad-wiki/shared-types.
 */
export { CreatePageSchema };
export type CreatePageDto = CreatePageInput;
