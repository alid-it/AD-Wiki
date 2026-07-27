import { z } from 'zod';
import {
  AclOverviewSchema,
  AclEntrySchema,
  RoleSchema,
  type AclEntry,
  type AclOverview,
  type CreateRoleInput,
  type Role,
  type SetAclInput,
  type UpdateRoleInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

/** Rechte-Übersicht aller Rollen inkl. Matrix-Achsen (`GET /acls`, Admin). */
export function list(signal?: AbortSignal): Promise<AclOverview> {
  return requestData(AclOverviewSchema, '/acls', { auth: true, signal });
}

/** Rechte einer Rolle komplett setzen (`PUT /acls/role/:roleId`, Admin). */
export function setRole(roleId: string, entries: SetAclInput): Promise<AclEntry[]> {
  return requestData(z.array(AclEntrySchema), `/acls/role/${roleId}`, {
    method: 'PUT',
    body: entries,
    auth: true,
  });
}

/** Zusätzliche Rolle anlegen (`POST /roles`). */
export function createRole(input: CreateRoleInput): Promise<Role> {
  return requestData(RoleSchema, '/roles', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Rollen-Metadaten bearbeiten (`PATCH /roles/:id`). */
export function updateRole(id: string, input: UpdateRoleInput): Promise<Role> {
  return requestData(RoleSchema, `/roles/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

/** Zusätzliche Rolle löschen (`DELETE /roles/:id`). */
export function deleteRole(id: string): Promise<Role> {
  return requestData(RoleSchema, `/roles/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}
