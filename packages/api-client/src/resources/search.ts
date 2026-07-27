import { z } from 'zod';
import {
  GlobalSearchMetaSchema,
  GlobalSearchResultSchema,
  SearchMetaSchema,
  SearchResultSchema,
  type GlobalSearchFilterType,
  type GlobalSearchMeta,
  type GlobalSearchResult,
  type SearchMeta,
  type SearchResult,
} from '@ad-wiki/shared-types';
import { requestList } from '../http';

/** Volltextsuche über veröffentlichte Seiten (`GET /search`). */
export function search(
  q: string,
  options: { page?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ data: SearchResult[]; meta: SearchMeta }> {
  return requestList(
    z.array(SearchResultSchema),
    '/search',
    { query: { q, page: options.page, limit: options.limit }, signal },
    SearchMetaSchema,
  );
}

/** Ergonomischer Alias für {@link search}. */
export const query = search;

/** Benutzerbezogene Suche über Wiki, Notizen, Richtlinien, Medien und Tags. */
export function globalSearch(
  q: string,
  options: { types?: GlobalSearchFilterType[]; page?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<{ data: GlobalSearchResult[]; meta: GlobalSearchMeta }> {
  return requestList(
    z.array(GlobalSearchResultSchema),
    '/search/global',
    {
      query: {
        q,
        types: options.types?.join(','),
        page: options.page,
        limit: options.limit,
      },
      signal,
      auth: true,
    },
    GlobalSearchMetaSchema,
  );
}
