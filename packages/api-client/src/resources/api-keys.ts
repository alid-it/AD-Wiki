import { z } from 'zod';
import {
  AdminApiKeySchema,
  ApiKeySchema,
  CreatedApiKeySchema,
  type AdminApiKey,
  type ApiKey,
  type CreateApiKeyInput,
  type CreatedApiKey,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

/** Eigene API Keys ohne geheime Werte auflisten. */
export function list(signal?: AbortSignal): Promise<ApiKey[]> {
  return requestData(z.array(ApiKeySchema), '/api-keys', { auth: true, signal });
}

/** API Key erstellen. Der Klartext wird ausschliesslich hier zurueckgegeben. */
export function create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
  return requestData(CreatedApiKeySchema, '/api-keys', {
    method: 'POST',
    body: input,
    auth: true,
  });
}

/** Eigenen API Key dauerhaft deaktivieren. */
export function deactivate(id: string): Promise<ApiKey> {
  return requestData(ApiKeySchema, `/api-keys/${id}`, {
    method: 'DELETE',
    auth: true,
  });
}

/** Admin-Uebersicht ueber alle API Keys aller Benutzer. */
export function listAll(signal?: AbortSignal): Promise<AdminApiKey[]> {
  return requestData(z.array(AdminApiKeySchema), '/api-keys/admin', { auth: true, signal });
}
