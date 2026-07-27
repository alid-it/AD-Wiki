import { z } from 'zod';

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.array(z.object({
      field: z.string(),
      message: z.string(),
    })).optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Meta-Block paginierter Listen-Antworten (`{ success, data, meta }`). */
export const PaginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** Einzelnes Suchergebnis (Ausschnitt einer Seite mit Relevanz-Rang). */
export const SearchResultSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  rank: z.number(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/** Meta-Block der Suche: Pagination plus der ausgeführte Suchbegriff. */
export const SearchMetaSchema = PaginationMetaSchema.extend({
  query: z.string(),
});

export type SearchMeta = z.infer<typeof SearchMetaSchema>;

/** Quellen, die über den `types`-Parameter der globalen Suche auswählbar sind. */
export const GlobalSearchFilterTypeSchema = z.enum([
  'pages',
  'notes',
  'standards',
  'media',
]);
export type GlobalSearchFilterType = z.infer<typeof GlobalSearchFilterTypeSchema>;

/** Query-Parameter für die benutzerbezogene globale Suche. */
export const GlobalSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  types: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value.split(',').map((type) => type.trim()).filter(Boolean)
        : value,
    z.array(GlobalSearchFilterTypeSchema).max(4).optional(),
  ),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type GlobalSearchQuery = z.infer<typeof GlobalSearchQuerySchema>;

export const GlobalSearchResultTypeSchema = z.enum([
  'page',
  'note',
  'standard',
  'media',
  'tag',
]);
export type GlobalSearchResultType = z.infer<typeof GlobalSearchResultTypeSchema>;

export const GlobalSearchMatchFieldSchema = z.enum([
  'title',
  'content',
  'description',
  'filename',
  'altText',
  'tag',
]);
export type GlobalSearchMatchField = z.infer<typeof GlobalSearchMatchFieldSchema>;

/** Einheitliches Ergebnisformat über Wiki, Notizen, Richtlinien, Medien und Tags. */
export const GlobalSearchResultSchema = z.object({
  type: GlobalSearchResultTypeSchema,
  id: z.string().uuid(),
  title: z.string(),
  excerpt: z.string().nullable(),
  matchField: GlobalSearchMatchFieldSchema,
  updatedAt: z.string().datetime(),
  url: z.string().min(1),
});
export type GlobalSearchResult = z.infer<typeof GlobalSearchResultSchema>;

export const GlobalSearchMetaSchema = PaginationMetaSchema.extend({
  query: z.string(),
});
export type GlobalSearchMeta = z.infer<typeof GlobalSearchMetaSchema>;
