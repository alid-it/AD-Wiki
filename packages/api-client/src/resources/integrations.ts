import { z } from 'zod';
import {
  IntegrationSyncRunSchema,
  MicrosoftTodoTaskLinkSchema,
  MicrosoftConnectionSchema,
  MicrosoftOAuthStartSchema,
  MicrosoftTodoListSchema,
  type IntegrationSyncRun,
  type MicrosoftConnection,
  type MicrosoftOAuthStart,
  type MicrosoftTodoList,
  type MicrosoftTodoTaskLink,
  type CreateMicrosoftTodoTaskInput,
  type SelectMicrosoftTodoListsInput,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';

const BASE = '/integrations/microsoft';

export function status(signal?: AbortSignal): Promise<MicrosoftConnection> {
  return requestData(MicrosoftConnectionSchema, `${BASE}/status`, { auth: true, signal });
}

export function startMicrosoftOAuth(): Promise<MicrosoftOAuthStart> {
  return requestData(MicrosoftOAuthStartSchema, `${BASE}/oauth/start`, { method: 'POST', auth: true });
}

export function lists(signal?: AbortSignal): Promise<MicrosoftTodoList[]> {
  return requestData(z.array(MicrosoftTodoListSchema), `${BASE}/lists`, { auth: true, signal });
}

export function selectLists(input: SelectMicrosoftTodoListsInput): Promise<MicrosoftConnection> {
  return requestData(MicrosoftConnectionSchema, `${BASE}/lists`, { method: 'PUT', body: input, auth: true });
}

export function sync(): Promise<IntegrationSyncRun> {
  return requestData(IntegrationSyncRunSchema, `${BASE}/sync`, { method: 'POST', auth: true });
}

export function createTask(input: CreateMicrosoftTodoTaskInput): Promise<MicrosoftTodoTaskLink> {
  return requestData(MicrosoftTodoTaskLinkSchema, `${BASE}/tasks`, { method: 'POST', body: input, auth: true });
}

export function syncRuns(signal?: AbortSignal): Promise<IntegrationSyncRun[]> {
  return requestData(z.array(IntegrationSyncRunSchema), `${BASE}/sync-runs`, { auth: true, signal });
}

export function disconnect(): Promise<MicrosoftConnection> {
  return requestData(MicrosoftConnectionSchema, `${BASE}/connection`, { method: 'DELETE', auth: true });
}
