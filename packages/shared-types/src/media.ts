import { z } from 'zod';
import { PageSchema } from './page';

/** Vollständiger Medien-Datensatz, wie ihn die API ausliefert. */
export const MediaSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  filepath: z.string(),
  mimetype: z.string(),
  size: z.number().int().nonnegative(),
  altText: z.string().nullable(),
  uploadedById: z.string().uuid(),
  uploadedBy: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
  }).optional(),
  pageIds: z.array(z.string().uuid()).default([]),
  pages: z.array(z.object({
    id: z.string().uuid(),
    title: z.string(),
    slug: z.string(),
  })).default([]),
  createdAt: z.string().datetime(),
});

export type Media = z.infer<typeof MediaSchema>;

/** Query-Parameter für die paginierte Medien-Liste. */
export const MediaQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  pageId: z.string().uuid().optional(),
  scope: z.enum(['all', 'mine']).optional(),
});

export type MediaQuery = z.infer<typeof MediaQuerySchema>;

/** Vollständige Liste der Seiten, denen ein Medium zugeordnet ist. */
export const SetMediaPagesSchema = z.object({
  pageIds: z.array(z.string().uuid()).max(100),
});

export type SetMediaPagesInput = z.infer<typeof SetMediaPagesSchema>;

/** Ergebnis eines Markdown-Imports: Upload plus automatisch erzeugte Wiki-Seite. */
export const MarkdownImportResultSchema = z.object({
  media: MediaSchema,
  page: PageSchema,
});

export type MarkdownImportResult = z.infer<typeof MarkdownImportResultSchema>;
