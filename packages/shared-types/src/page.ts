import { z } from 'zod';

export const PageStatus = z.enum(['draft', 'published', 'archived']);
export type PageStatus = z.infer<typeof PageStatus>;

/** Unterscheidung zwischen Ordner (Container) und echter Inhaltsseite. */
export const PageType = z.enum(['folder', 'page']);
export type PageType = z.infer<typeof PageType>;

const TagNameSchema = z.string().trim().min(1).max(40);

/** Vollständige Seite, wie sie von der API zurückgegeben wird. */
export const PageSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  type: PageType,
  content: z.string(),
  excerpt: z.string().max(500).nullable().optional(),
  status: PageStatus,
  isPublic: z.boolean().default(false),
  mcpVisible: z.boolean().default(false),
  knowledgeType: z.literal('wiki'),
  knowledgePriority: z.literal(2),
  authorId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  tags: z.array(TagNameSchema).max(20).default([]),
  version: z.number().int().positive(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Page = z.infer<typeof PageSchema>;

/** Eingabe zum Erstellen einer Seite oder eines Ordners. */
export const CreatePageSchema = z.object({
  title: z.string().min(1).max(200),
  spaceId: z.string().uuid().optional(),
  type: PageType.default('page'),
  // Ordner (type=folder) haben keinen Inhalt, daher leerer Default.
  content: z.string().default(''),
  excerpt: z.string().max(500).optional(),
  status: PageStatus.default('draft'),
  isPublic: z.boolean().default(false),
  mcpVisible: z.boolean().default(false),
  categoryId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  tags: z.array(TagNameSchema).max(20).default([]),
  // Der Autor wird serverseitig aus dem JWT abgeleitet und ist bewusst
  // NICHT Teil des Requests, damit er nicht fälschbar ist.
});

export type CreatePageInput = z.infer<typeof CreatePageSchema>;

/**
 * Eingabe zum Importieren einer bereits hochgeladenen Markdown-Datei als neue
 * Wiki-Seite (`POST /pages/import-markdown`). Der Inhalt wird serverseitig aus
 * der Datei gelesen; der Autor stammt aus dem JWT.
 */
export const ImportMarkdownSchema = z.object({
  /** ID des zuvor hochgeladenen Markdown-Mediums. */
  mediaId: z.string().uuid(),
  title: z.string().min(1).max(200),
  spaceId: z.string().uuid().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  status: PageStatus.default('draft'),
});

export type ImportMarkdownInput = z.infer<typeof ImportMarkdownSchema>;

/** Eingabe zum Bearbeiten einer Seite – alle Felder optional. */
export const UpdatePageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  spaceId: z.string().uuid().optional(),
  content: z.string().optional(),
  excerpt: z.string().max(500).nullable().optional(),
  status: PageStatus.optional(),
  isPublic: z.boolean().optional(),
  mcpVisible: z.boolean().optional(),
  type: PageType.optional(),
  categoryId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  tags: z.array(TagNameSchema).max(20).optional(),
  sortOrder: z.number().int().optional(),
  // Optionale Änderungsnotiz, die in der erzeugten PageVersion gespeichert wird.
  changeMessage: z.string().max(500).optional(),
});

export type UpdatePageInput = z.infer<typeof UpdatePageSchema>;

/** Query-Parameter für die paginierte, filterbare Seitenliste. */
export const PageQuerySchema = z.object({
  spaceId: z.string().uuid().optional(),
  status: PageStatus.optional(),
  /** Optional nur Inhaltsseiten oder nur Ordner laden. */
  type: PageType.optional(),
  // Filter nach Kategorie-Slug.
  category: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(100).default(20),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

// ── Baumstruktur für die Sidebar (Antwort von GET /pages/tree/:categorySlug) ──

/** Kompakte Kategorie-Info im Kopf der Baumstruktur. */
export const PageTreeCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export type PageTreeCategory = z.infer<typeof PageTreeCategorySchema>;

/** Ein Ordner (type=folder) mit seinen enthaltenen Seiten. */
export const PageTreeFolderSchema = PageSchema.extend({
  pages: z.array(PageSchema),
});

export type PageTreeFolder = z.infer<typeof PageTreeFolderSchema>;

/**
 * Verschachtelte Baumstruktur einer Kategorie:
 * Kategorie → Ordner (mit Seiten) + direkt zugeordnete Seiten (ohne Ordner).
 */
export const PageTreeSchema = z.object({
  category: PageTreeCategorySchema,
  folders: z.array(PageTreeFolderSchema),
  pages: z.array(PageSchema),
});

export type PageTree = z.infer<typeof PageTreeSchema>;

/** Baum der Seiten ohne Kategorie (Antwort von GET /pages/uncategorized). */
export const UncategorizedTreeSchema = z.object({
  folders: z.array(PageTreeFolderSchema),
  pages: z.array(PageSchema),
});

export type UncategorizedTree = z.infer<typeof UncategorizedTreeSchema>;

/** Kompakte Autor-Info, wie sie angereicherte Endpunkte mitliefern. */
export const AuthorRefSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
});

export type AuthorRef = z.infer<typeof AuthorRefSchema>;

export const TrashPageSchema = PageSchema.extend({
  deletedAt: z.string().datetime(),
  deletedBy: AuthorRefSchema.nullable(),
});
export type TrashPage = z.infer<typeof TrashPageSchema>;

/** Kompakte Kategorie-Referenz (für die Artikelansicht). */
export const CategoryRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export type CategoryRef = z.infer<typeof CategoryRefSchema>;

/** Kompakte Referenz auf eine übergeordnete Wiki-Seite oder einen Ordner. */
export const PageAncestorSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  type: PageType,
});

export type PageAncestor = z.infer<typeof PageAncestorSchema>;

/**
 * Einzelseite inkl. Autor und Kategorie (Antwort von GET /pages/:slug).
 * Erweitert {@link PageSchema} um die aufgelösten Referenzen.
 */
export const PageDetailSchema = PageSchema.extend({
  author: AuthorRefSchema,
  category: CategoryRefSchema.nullable(),
  ancestors: z.array(PageAncestorSchema).default([]),
});

export type PageDetail = z.infer<typeof PageDetailSchema>;

/** Query-Parameter für verwandte Wiki-Seiten. */
export const RelatedPagesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(20).default(5),
});
export type RelatedPagesQuery = z.infer<typeof RelatedPagesQuerySchema>;

/** Kompakte verwandte Seite mit den für die Rangfolge relevanten Beziehungen. */
export const RelatedPageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  sharedTags: z.array(TagNameSchema),
  category: CategoryRefSchema.nullable(),
});
export type RelatedPage = z.infer<typeof RelatedPageSchema>;

/** Anonym lesbare, veröffentlichte Wiki-Seite. */
export const PublicPageSchema = z.object({
  title: z.string(),
  slug: z.string(),
  content: z.string(),
  updatedAt: z.string().datetime(),
});
export type PublicPage = z.infer<typeof PublicPageSchema>;

/** Ein Eintrag der Versionshistorie (Antwort von GET /pages/:id/versions). */
export const PageVersionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  version: z.number().int().positive(),
  changeMessage: z.string().nullable(),
  authorId: z.string().uuid(),
  author: AuthorRefSchema,
  createdAt: z.string().datetime(),
});

export type PageVersion = z.infer<typeof PageVersionSchema>;

/**
 * Serverseitig gespeicherter Autosave-Entwurf einer Seite (pro Benutzer).
 * Titel darf leer sein, da während des Tippens auch Zwischenstände landen.
 */
export const SavePageDraftSchema = z.object({
  title: z.string().max(200),
  content: z.string(),
  status: PageStatus.default('draft'),
  isPublic: z.boolean().default(false),
  mcpVisible: z.boolean().default(false),
  tags: z.array(TagNameSchema).max(20).default([]),
});

export type SavePageDraftInput = z.infer<typeof SavePageDraftSchema>;

/** Antwort für den aktuellen Entwurf einer Seite (`GET /pages/:id/draft`). */
export const PageDraftSchema = z.object({
  title: z.string(),
  content: z.string(),
  status: PageStatus,
  isPublic: z.boolean(),
  mcpVisible: z.boolean(),
  tags: z.array(TagNameSchema),
  updatedAt: z.string().datetime(),
});

export type PageDraft = z.infer<typeof PageDraftSchema>;
