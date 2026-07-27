import { z } from 'zod';
import {
  IdentityProviderAdminSchema,
  IdentityProviderDetailsSchema,
  IdentityProviderGroupMappingSchema,
  IdentityProviderReferenceDataSchema,
  IdentityProviderRoleMappingSchema,
  IdentitySyncHistoryEntrySchema,
  IdentitySyncStatusSchema,
  type CreateIdentityProviderGroupMappingInput,
  type CreateIdentityProviderInput,
  type CreateIdentityProviderRoleMappingInput,
  type DeleteIdentityProviderInput,
  type IdentityProviderAdmin,
  type IdentityProviderDetails,
  type IdentityProviderGroupMapping,
  type IdentityProviderReferenceData,
  type IdentityProviderRoleMapping,
  type IdentitySyncHistoryEntry,
  type IdentitySyncStatus,
  type UpdateIdentityProviderInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

const basePath = '/identity-providers';

export function list(signal?: AbortSignal): Promise<IdentityProviderAdmin[]> {
  return requestData(z.array(IdentityProviderAdminSchema), basePath, {
    auth: true,
    signal,
  });
}

export function get(
  providerId: string,
  signal?: AbortSignal,
): Promise<IdentityProviderDetails> {
  return requestData(
    IdentityProviderDetailsSchema,
    `${basePath}/${encodeURIComponent(providerId)}`,
    { auth: true, signal },
  );
}

export function referenceData(
  signal?: AbortSignal,
): Promise<IdentityProviderReferenceData> {
  return requestData(
    IdentityProviderReferenceDataSchema,
    `${basePath}/reference-data`,
    { auth: true, signal },
  );
}

export function create(
  input: CreateIdentityProviderInput,
): Promise<IdentityProviderAdmin> {
  return requestData(IdentityProviderAdminSchema, basePath, {
    method: 'POST',
    auth: true,
    body: input,
  });
}

export function update(
  providerId: string,
  input: UpdateIdentityProviderInput,
): Promise<IdentityProviderAdmin> {
  return requestData(
    IdentityProviderAdminSchema,
    `${basePath}/${encodeURIComponent(providerId)}`,
    { method: 'PATCH', auth: true, body: input },
  );
}

export function remove(
  providerId: string,
  input: DeleteIdentityProviderInput,
): Promise<void> {
  return requestData(
    z.unknown().transform(() => undefined),
    `${basePath}/${encodeURIComponent(providerId)}`,
    { method: 'DELETE', auth: true, body: input },
  );
}

export function createGroupMapping(
  providerId: string,
  input: CreateIdentityProviderGroupMappingInput,
): Promise<IdentityProviderGroupMapping> {
  return requestData(
    IdentityProviderGroupMappingSchema,
    `${basePath}/${encodeURIComponent(providerId)}/group-mappings`,
    { method: 'POST', auth: true, body: input },
  );
}

export function removeGroupMapping(
  providerId: string,
  mappingId: string,
): Promise<void> {
  return requestData(
    z.unknown().transform(() => undefined),
    `${basePath}/${encodeURIComponent(providerId)}/group-mappings/${encodeURIComponent(mappingId)}`,
    { method: 'DELETE', auth: true },
  );
}

export function createRoleMapping(
  providerId: string,
  input: CreateIdentityProviderRoleMappingInput,
): Promise<IdentityProviderRoleMapping> {
  return requestData(
    IdentityProviderRoleMappingSchema,
    `${basePath}/${encodeURIComponent(providerId)}/role-mappings`,
    { method: 'POST', auth: true, body: input },
  );
}

export function removeRoleMapping(
  providerId: string,
  mappingId: string,
): Promise<void> {
  return requestData(
    z.unknown().transform(() => undefined),
    `${basePath}/${encodeURIComponent(providerId)}/role-mappings/${encodeURIComponent(mappingId)}`,
    { method: 'DELETE', auth: true },
  );
}

export function synchronizationStatus(
  providerId: string,
  signal?: AbortSignal,
): Promise<IdentitySyncStatus[]> {
  return requestData(
    z.array(IdentitySyncStatusSchema),
    `${basePath}/${encodeURIComponent(providerId)}/synchronization/status`,
    { auth: true, signal },
  );
}

export function synchronizationHistory(
  providerId: string,
  signal?: AbortSignal,
): Promise<IdentitySyncHistoryEntry[]> {
  return requestData(
    z.array(IdentitySyncHistoryEntrySchema),
    `${basePath}/${encodeURIComponent(providerId)}/synchronization/history`,
    { auth: true, signal },
  );
}
