import { z } from 'zod';
import {
  ResourceAccessDecisionSchema,
  ResourceAclBoundarySchema,
  ResourceAclEntrySchema,
  type CreateResourceAclEntryInput,
  type EvaluateResourceAccessInput,
  type ResourceAccessDecision,
  type ResourceAclBoundary,
  type ResourceAclEntry,
  type ResourceAclListQuery,
  type SetResourceAclBoundaryInput,
  type UpdateResourceAclEntryInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

export function list(
  query: ResourceAclListQuery = {},
  signal?: AbortSignal,
): Promise<ResourceAclEntry[]> {
  return requestData(z.array(ResourceAclEntrySchema), '/resource-acls', {
    query,
    auth: true,
    signal,
  });
}

export function boundaries(
  query: ResourceAclListQuery = {},
  signal?: AbortSignal,
): Promise<ResourceAclBoundary[]> {
  return requestData(
    z.array(ResourceAclBoundarySchema),
    '/resource-acls/boundaries',
    { query, auth: true, signal },
  );
}

export function create(
  input: CreateResourceAclEntryInput,
): Promise<ResourceAclEntry> {
  return requestData(ResourceAclEntrySchema, '/resource-acls', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function update(
  id: string,
  input: UpdateResourceAclEntryInput,
): Promise<ResourceAclEntry> {
  return requestData(ResourceAclEntrySchema, `/resource-acls/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function remove(id: string): Promise<ResourceAclEntry> {
  return requestData(ResourceAclEntrySchema, `/resource-acls/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

export function setBoundary(
  input: SetResourceAclBoundaryInput,
): Promise<ResourceAclBoundary> {
  return requestData(ResourceAclBoundarySchema, '/resource-acls/boundaries', {
    method: 'PUT',
    body: input,
    auth: true,
  });
}

export function removeBoundary(
  input: SetResourceAclBoundaryInput,
): Promise<ResourceAclBoundary> {
  const { targetType, targetId, action } = input;
  return requestData(
    ResourceAclBoundarySchema,
    `/resource-acls/boundaries/${targetType}/${targetId}/${action}`,
    { method: 'DELETE', auth: true },
  );
}

export function evaluate(
  input: EvaluateResourceAccessInput,
): Promise<ResourceAccessDecision> {
  return requestData(
    ResourceAccessDecisionSchema,
    '/resource-acls/evaluate',
    { method: 'POST', body: input, auth: true },
  );
}
