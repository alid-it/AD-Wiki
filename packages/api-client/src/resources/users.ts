import { z } from 'zod';
import {
  AuthUserSchema,
  AdminUserSchema,
  AclEntrySchema,
  MessageResultSchema,
  RoleOptionSchema,
  type AdminUser,
  type AuthUser,
  type AclEntry,
  type AdminResetPasswordInput,
  type AssignUserRoleInput,
  type CreateUserInput,
  type MessageResult,
  type RoleOption,
  type SetAclInput,
  type UpdateProfileInput,
  type UpdateUserInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

/** Eigenes Profil aktualisieren (`PATCH /users/me`, geschützt). */
export function updateMe(input: UpdateProfileInput): Promise<AuthUser> {
  return requestData(AuthUserSchema, '/users/me', {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

// ── Admin ──────────────────────────────────────────────

/** Alle Benutzer auflisten (`GET /users`, Admin). */
export function list(signal?: AbortSignal): Promise<AdminUser[]> {
  return requestData(z.array(AdminUserSchema), '/users', { auth: true, signal });
}

/** Verfügbare Rollen für Benutzeranlage und -zuweisung. */
export function roleOptions(signal?: AbortSignal): Promise<RoleOption[]> {
  return requestData(z.array(RoleOptionSchema), '/users/role-options', {
    auth: true,
    signal,
  });
}

/** Benutzer durch einen Administrator anlegen. */
export function create(input: CreateUserInput): Promise<AdminUser> {
  return requestData(AdminUserSchema, '/users', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Reset-Link an die hinterlegte E-Mail-Adresse senden. */
export function sendPasswordResetEmail(id: string): Promise<MessageResult> {
  return requestData(MessageResultSchema, `/users/${id}/password-reset-email`, {
    method: 'POST',
    auth: true,
  });
}

/** Passwort eines anderen Benutzers direkt neu setzen. */
export function resetPassword(id: string, input: AdminResetPasswordInput): Promise<MessageResult> {
  return requestData(MessageResultSchema, `/users/${id}/password`, {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Einzelnen Benutzer laden (`GET /users/:id`, Admin). */
export function byId(id: string, signal?: AbortSignal): Promise<AdminUser> {
  return requestData(AdminUserSchema, `/users/${id}`, { auth: true, signal });
}

/** Status eines Benutzers ändern (`PATCH /users/:id`). */
export function update(id: string, input: UpdateUserInput): Promise<AdminUser> {
  return requestData(AdminUserSchema, `/users/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** Rolle eines Benutzers über den gesonderten Sicherheitsweg zuweisen. */
export function assignRole(id: string, input: AssignUserRoleInput): Promise<AdminUser> {
  return requestData(AdminUserSchema, `/users/${id}/role`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** Benutzer deaktivieren (`DELETE /users/:id`, Admin). */
export function deactivate(id: string): Promise<AdminUser> {
  return requestData(AdminUserSchema, `/users/${id}`, { method: 'DELETE', auth: true });
}

/** Individuelle Permissions eines Users lesen (`GET /users/:id/permissions`, Admin). */
export function getPermissions(id: string, signal?: AbortSignal): Promise<AclEntry[]> {
  return requestData(z.array(AclEntrySchema), `/users/${id}/permissions`, { auth: true, signal });
}

/** Individuelle Permissions eines Users setzen (`PUT /users/:id/permissions`, Admin). */
export function setPermissions(id: string, entries: SetAclInput): Promise<AclEntry[]> {
  return requestData(z.array(AclEntrySchema), `/users/${id}/permissions`, {
    method: 'PUT',
    body: entries,
    auth: true,
  });
}
