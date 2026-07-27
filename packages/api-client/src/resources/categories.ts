import { z } from 'zod';
import {
  CategorySchema,
  CategoryWithCountSchema,
  type CategoryScope,
  type CategoryWithCount,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@ad-wiki/shared-types';
import { requestData, requestVoid } from '../http';

/** Alle Kategorien inklusive Seitenanzahl (`GET /categories`). */
export function list(signal?: AbortSignal, scope: CategoryScope = 'wiki', spaceId?: string): Promise<CategoryWithCount[]> {
  return requestData(z.array(CategoryWithCountSchema), '/categories', { signal, query: { scope, spaceId }, auth: true });
}

/** Eine Kategorie samt ihrer Seiten (`GET /categories/:slug`). */
export function bySlug(slug: string, signal?: AbortSignal, scope: CategoryScope = 'wiki', spaceId?: string) {
  // Die API liefert hier zusätzlich die Seitenliste; wir validieren die
  // Kern-Kategorie und reichen die Seiten unverändert durch.
  return requestData(
    CategorySchema.extend({ pages: z.array(z.unknown()).optional() }),
    `/categories/${slug}`,
    { signal, query: { scope, spaceId }, auth: true },
  );
}

/** Neue Kategorie anlegen (`POST /categories`). */
export function create(input: CreateCategoryInput) {
  return requestData(CategorySchema, '/categories', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Kategorie bearbeiten (`PATCH /categories/:id`). */
export function update(id: string, input: UpdateCategoryInput) {
  return requestData(CategorySchema, `/categories/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** Kategorie löschen (`DELETE /categories/:id`). */
export function remove(id: string): Promise<void> {
  return requestVoid(`/categories/${id}`, { method: 'DELETE', auth: true });
}
