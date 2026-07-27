import { z } from 'zod';
import {
  KnowledgeSpaceSchema,
  type CreateKnowledgeSpaceInput,
  type KnowledgeSpace,
  type UpdateKnowledgeSpaceInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

export function list(signal?: AbortSignal): Promise<KnowledgeSpace[]> {
  return requestData(z.array(KnowledgeSpaceSchema), '/spaces', {
    auth: true,
    signal,
  });
}

export function byId(
  id: string,
  signal?: AbortSignal,
): Promise<KnowledgeSpace> {
  return requestData(KnowledgeSpaceSchema, `/spaces/${id}`, {
    auth: true,
    signal,
  });
}

export function create(
  input: CreateKnowledgeSpaceInput,
): Promise<KnowledgeSpace> {
  return requestData(KnowledgeSpaceSchema, '/spaces', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

export function update(
  id: string,
  input: UpdateKnowledgeSpaceInput,
): Promise<KnowledgeSpace> {
  return requestData(KnowledgeSpaceSchema, `/spaces/${id}`, {
    method: 'PATCH',
    body: input,
    auth: true,
  });
}

export function remove(id: string): Promise<KnowledgeSpace> {
  return requestData(KnowledgeSpaceSchema, `/spaces/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}
