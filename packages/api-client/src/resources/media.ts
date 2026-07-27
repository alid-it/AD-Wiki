import { z } from 'zod';
import {
  MarkdownImportResultSchema,
  MediaSchema,
  type MarkdownImportResult,
  type Media,
  type MediaQuery,
  type SetMediaPagesInput,
} from '@ad-wiki/shared-types';
import { requestData, requestDownload, requestList, requestVoid } from '../http';

/** Paginierte Medien-Liste (`GET /media`). */
export function list(query: MediaQuery, signal?: AbortSignal) {
  return requestList(z.array(MediaSchema), '/media', {
    query: { page: query.page, limit: query.limit, pageId: query.pageId, scope: query.scope },
    signal,
    auth: true,
  });
}

/** Geschuetzte Datei laden; oeffentliche Seiten funktionieren auch ohne Token. */
export function file(id: string, signal?: AbortSignal) {
  return requestDownload(`/media/${id}/file`, { auth: true, signal });
}

/** Einzelne Datei-Info (`GET /media/:id`). */
export function byId(id: string, signal?: AbortSignal): Promise<Media> {
  return requestData(MediaSchema, `/media/${id}`, { signal, auth: true });
}

/** Datei hochladen (`POST /media/upload`, geschützt). */
export function upload(file: File): Promise<Media> {
  const formData = new FormData();
  formData.append('file', file);
  return requestData(MediaSchema, '/media/upload', {
    method: 'POST',
    formData,
    auth: true,
  });
}

/** Markdown hochladen und automatisch als Wiki-Seite anlegen. */
export function importMarkdown(file: File): Promise<MarkdownImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  return requestData(MarkdownImportResultSchema, '/media/import-markdown', {
    method: 'POST',
    formData,
    auth: true,
  });
}

/** Seitenzuordnungen eines Mediums vollständig ersetzen. */
export function setPages(id: string, input: SetMediaPagesInput): Promise<Media> {
  return requestData(MediaSchema, `/media/${id}/pages`, {
    method: 'PUT',
    body: input,
    auth: true,
  });
}

/** Datei löschen (`DELETE /media/:id`, geschützt). */
export function remove(id: string): Promise<void> {
  return requestVoid(`/media/${id}`, { method: 'DELETE', auth: true });
}
