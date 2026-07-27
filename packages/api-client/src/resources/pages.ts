import { z } from 'zod';
import {
  PageSchema,
  PageTreeSchema,
  PageDetailSchema,
  PageVersionSchema,
  PageDraftSchema,
  PublicPageSchema,
  RelatedPageSchema,
  UncategorizedTreeSchema,
  type PageDraft,
  type SavePageDraftInput,
  type CreatePageInput,
  type ImportMarkdownInput,
  type Page,
  type PageDetail,
  type PageQuery,
  type PageTree,
  type PageVersion,
  type PublicPage,
  type RelatedPage,
  TrashPageSchema,
  type TrashPage,
  type UncategorizedTree,
  type UpdatePageInput,
  type ToggleCheckboxInput,
} from '@ad-wiki/shared-types';
import { requestData, requestList, requestVoid } from '../http';

/** Paginierte, filterbare Seitenliste (`GET /pages`). */
export function list(query: PageQuery, signal?: AbortSignal) {
  return requestList(z.array(PageSchema), '/pages', {
    query: {
      status: query.status,
      type: query.type,
      spaceId: query.spaceId,
      category: query.category,
      page: query.page,
      perPage: query.perPage,
    },
    signal,
    auth: true,
  });
}

/** Baumstruktur einer Kategorie für die Sidebar (`GET /pages/tree/:categorySlug`). */
export function tree(categorySlug: string, signal?: AbortSignal, spaceId?: string): Promise<PageTree> {
  return requestData(PageTreeSchema, `/pages/tree/${categorySlug}`, { query: { spaceId }, signal, auth: true });
}

/** Baum der Seiten ohne Kategorie (`GET /pages/uncategorized`). */
export function uncategorized(signal?: AbortSignal, spaceId?: string): Promise<UncategorizedTree> {
  return requestData(UncategorizedTreeSchema, '/pages/uncategorized', { query: { spaceId }, signal, auth: true });
}

/** Bereits bekannte Tags für Vorschläge im Seiteneditor (`GET /pages/tags`). */
export function tags(signal?: AbortSignal): Promise<string[]> {
  return requestData(z.array(z.string()), '/pages/tags', { signal, auth: true });
}

/**
 * Einzelne Seite anhand ihres Slugs, angereichert um Autor und Kategorie
 * (`GET /pages/:slug`).
 */
export function bySlug(slug: string, signal?: AbortSignal): Promise<PageDetail> {
  return requestData(PageDetailSchema, `/pages/${slug}`, { signal, auth: true });
}

/** Anonyme, veröffentlichte Seite ohne interne Metadaten. */
export function publicBySlug(slug: string, signal?: AbortSignal): Promise<PublicPage> {
  return requestData(PublicPageSchema, `/pages/public/${slug}`, { signal });
}

const LinkPageSchema = z.object({ id: z.string().uuid(), title: z.string(), slug: z.string() });
export function backlinks(slug: string, signal?: AbortSignal) {
  return requestData(z.array(LinkPageSchema), `/pages/${slug}/backlinks`, { signal, auth: true });
}
export function standardBacklinks(slug: string, signal?: AbortSignal) {
  return requestData(z.array(z.object({ id: z.string().uuid(), title: z.string(), slug: z.string(), status: z.enum(['draft', 'review', 'active', 'deprecated']) })), `/pages/${slug}/standard-backlinks`, { signal, auth: true });
}

/** Nach gemeinsamen Tags und Kategorie sortierte verwandte Wiki-Seiten. */
export function related(id: string, limit = 5, signal?: AbortSignal): Promise<RelatedPage[]> {
  return requestData(z.array(RelatedPageSchema), `/pages/${id}/related`, {
    query: { limit },
    signal,
    auth: true,
  });
}
export function graph(mode: 'wiki' | 'mcp' = 'wiki', signal?: AbortSignal) {
  return requestData(z.object({
    nodes: z.array(z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      type: z.enum(['root', 'wiki', 'category', 'folder', 'page', 'note-root', 'note-category', 'note', 'standard-root', 'standard-category', 'standard']),
      mcpVisible: z.boolean(),
      group: z.string(),
    })),
    links: z.array(z.object({
      sourceId: z.string(),
      targetId: z.string(),
      kind: z.enum(['structure', 'wiki', 'standard']),
    })),
  }), '/pages/graph', { query: { mode: mode === 'mcp' ? 'mcp' : undefined }, signal, auth: true });
}

/** Versionshistorie einer Seite (`GET /pages/:id/versions`). */
export function versions(id: string, signal?: AbortSignal): Promise<PageVersion[]> {
  return requestData(z.array(PageVersionSchema), `/pages/${id}/versions`, { signal, auth: true });
}

/** Autosave-Entwurf des Benutzers für diese Seite laden (`GET /pages/:id/draft`). */
export function getDraft(id: string, signal?: AbortSignal): Promise<PageDraft | null> {
  return requestData(PageDraftSchema.nullable(), `/pages/${id}/draft`, { signal, auth: true });
}

/** Autosave-Entwurf speichern (`PUT /pages/:id/draft`). */
export function saveDraft(id: string, input: SavePageDraftInput): Promise<PageDraft> {
  return requestData(PageDraftSchema, `/pages/${id}/draft`, { method: 'PUT', body: input, auth: true });
}

/** Autosave-Entwurf verwerfen (`DELETE /pages/:id/draft`). */
export function deleteDraft(id: string): Promise<void> {
  return requestVoid(`/pages/${id}/draft`, { method: 'DELETE', auth: true });
}

/** Neue Seite oder Ordner erstellen (`POST /pages`). */
export function create(input: CreatePageInput): Promise<Page> {
  return requestData(PageSchema, '/pages', { method: 'POST', body: input, auth: true });
}

/** Ein Markdown-Medium als neue Wiki-Seite importieren (`POST /pages/import-markdown`). */
export function importMarkdown(input: ImportMarkdownInput): Promise<Page> {
  return requestData(PageSchema, '/pages/import-markdown', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Seite bearbeiten (`PATCH /pages/:id`). */
export function update(id: string, input: UpdatePageInput): Promise<Page> {
  return requestData(PageSchema, `/pages/${id}`, { method: 'PATCH', body: input, auth: true });
}

/** Checklisteneintrag ohne neue PageVersion schalten. */
export function toggleCheckbox(id: string, input: ToggleCheckboxInput): Promise<Page> {
  return requestData(PageSchema, `/pages/${id}/checkbox`, { method: 'PATCH', body: input, auth: true });
}

/** Seite löschen (`DELETE /pages/:id`). */
export function remove(id: string): Promise<void> {
  return requestVoid(`/pages/${id}`, { method: 'DELETE', auth: true });
}

export function trash(): Promise<TrashPage[]> { return requestData(z.array(TrashPageSchema), '/pages/trash', { auth: true }); }
export function restore(id: string): Promise<Page> { return requestData(PageSchema, `/pages/${id}/restore`, { method: 'POST', auth: true }); }
export function permanentRemove(id: string): Promise<void> { return requestVoid(`/pages/${id}/permanent`, { method: 'DELETE', auth: true }); }
export function emptyTrash(): Promise<{ count: number }> { return requestData(z.object({ count: z.number().int().nonnegative() }), '/pages/trash/permanent', { method: 'DELETE', auth: true }); }
