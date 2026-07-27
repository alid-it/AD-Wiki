import { z } from 'zod';

export const CategoryScopeSchema = z.enum(['wiki', 'note', 'standard']);
export type CategoryScope = z.infer<typeof CategoryScopeSchema>;

/** Vollständige Kategorie, wie sie von der API zurückgegeben wird. */
export const CategorySchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(120),
  scope: CategoryScopeSchema,
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
});

export type Category = z.infer<typeof CategorySchema>;

/**
 * Kategorie inklusive Anzahl zugeordneter Seiten.
 * Antwortform von `GET /categories` (Liste).
 */
export const CategoryWithCountSchema = CategorySchema.extend({
  pageCount: z.number().int().nonnegative(),
  noteCount: z.number().int().nonnegative(),
  standardCount: z.number().int().nonnegative(),
  contentCount: z.number().int().nonnegative(),
});

export type CategoryWithCount = z.infer<typeof CategoryWithCountSchema>;

/** Eingabe zum Erstellen einer neuen Kategorie. */
export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(100),
  spaceId: z.string().uuid().optional(),
  scope: CategoryScopeSchema.default('wiki'),
  description: z.string().max(500).optional(),
  icon: z.string().max(100).optional(),
  sortOrder: z.number().int().optional(),
});

export type CreateCategoryInput = z.input<typeof CreateCategorySchema>;

/** Eingabe zum Bearbeiten einer Kategorie – alle Felder optional. */
export const UpdateCategorySchema = CreateCategorySchema.partial();

export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
