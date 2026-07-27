import { CreateCategorySchema, type CreateCategoryInput } from "@ad-wiki/shared-types";

/**
 * DTO zum Erstellen einer Kategorie.
 * Validierung erfolgt über das zentrale Zod-Schema aus @ad-wiki/shared-types
 * (Single Source of Truth) – keine eigene Duplizierung der Regeln.
 */
export { CreateCategorySchema };
export type CreateCategoryDto = CreateCategoryInput;
