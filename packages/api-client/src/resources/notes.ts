import { z } from 'zod';
import {
  NoteSchema,
  type CreateNoteInput,
  type Note,
  type NoteQuery,
  type PromoteNoteInput,
  type ShareNoteInput,
  type UpdateNoteInput,
  type ToggleCheckboxInput,
  PageSchema,
} from '@ad-wiki/shared-types';
import { requestData, requestVoid } from '../http';

const UserRefSchema = z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string().email() });

export function list(query: NoteQuery, signal?: AbortSignal): Promise<Note[]> {
  return requestData(z.array(NoteSchema), '/notes', { query: { scope: query.scope, spaceId: query.spaceId, status: query.status, q: query.q }, signal, auth: true });
}
export function trash(signal?: AbortSignal): Promise<Note[]> { return requestData(z.array(NoteSchema), '/notes/trash', { signal, auth: true }); }
export function byId(id: string, signal?: AbortSignal): Promise<Note> { return requestData(NoteSchema, `/notes/${id}`, { signal, auth: true }); }
export function create(input: CreateNoteInput): Promise<Note> { return requestData(NoteSchema, '/notes', { method: 'POST', body: input, auth: true }); }
export function update(id: string, input: UpdateNoteInput): Promise<Note> { return requestData(NoteSchema, `/notes/${id}`, { method: 'PATCH', body: input, auth: true }); }
export function toggleCheckbox(id: string, input: ToggleCheckboxInput): Promise<Note> { return requestData(NoteSchema, `/notes/${id}/checkbox`, { method: 'PATCH', body: input, auth: true }); }
export function remove(id: string): Promise<void> { return requestVoid(`/notes/${id}`, { method: 'DELETE', auth: true }); }
export function restore(id: string): Promise<Note> { return requestData(NoteSchema, `/notes/${id}/restore`, { method: 'POST', auth: true }); }
export function permanentRemove(id: string, deleteExternal = false): Promise<void> { return requestVoid(`/notes/${id}/permanent`, { method: 'DELETE', query: { deleteExternal: String(deleteExternal) }, auth: true }); }
export function share(id: string, input: ShareNoteInput): Promise<Note> { return requestData(NoteSchema, `/notes/${id}/share`, { method: 'POST', body: input, auth: true }); }
export function unshare(id: string, userId: string): Promise<Note> { return requestData(NoteSchema, `/notes/${id}/share/${userId}`, { method: 'DELETE', auth: true }); }
export function shareCandidates(signal?: AbortSignal) { return requestData(z.array(UserRefSchema), '/notes/share-candidates', { signal, auth: true }); }
export function promoteToWiki(id: string, input: PromoteNoteInput) { return requestData(PageSchema, `/notes/${id}/promote-to-wiki`, { method: 'POST', body: input, auth: true }); }
