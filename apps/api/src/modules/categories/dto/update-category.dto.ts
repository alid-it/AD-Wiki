import { UpdateCategorySchema, type UpdateCategoryInput } from "@ad-wiki/shared-types";

/**
 * DTO zum Bearbeiten einer Kategorie.
 * Alle Felder optional – validiert über das Zod-Schema aus @ad-wiki/shared-types.
 */
export { UpdateCategorySchema };
export type UpdateCategoryDto = UpdateCategoryInput;
