import { UpdatePageSchema, type UpdatePageInput } from "@ad-wiki/shared-types";

/**
 * DTO zum Bearbeiten einer Seite.
 * Alle Felder optional – validiert über das Zod-Schema aus @ad-wiki/shared-types.
 */
export { UpdatePageSchema };
export type UpdatePageDto = UpdatePageInput;
