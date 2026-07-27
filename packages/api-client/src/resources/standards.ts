import { z } from 'zod';
import {
  StandardSchema, StandardVersionSchema,
  type CreateStandardInput, type CreateStandardRuleInput, type DecideStandardExceptionInput,
  type RequestStandardExceptionInput, type StandardQuery, type UpdateStandardInput, type UpdateStandardRuleInput,
} from '@ad-wiki/shared-types';
import { requestData, requestVoid } from '../http';

export function list(query: StandardQuery = {}, signal?: AbortSignal) { return requestData(z.array(StandardSchema), '/standards', { query, signal, auth: true }); }
export function byId(id: string, signal?: AbortSignal) { return requestData(StandardSchema, `/standards/${id}`, { signal, auth: true }); }
export function options(signal?: AbortSignal) { return requestData(z.object({ users: z.array(z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string() })), categories: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })), pages: z.array(z.object({ id: z.string().uuid(), title: z.string(), slug: z.string() })) }), '/standards/options', { signal, auth: true }); }
export function create(input: CreateStandardInput) { return requestData(StandardSchema, '/standards', { method: 'POST', body: input, auth: true }); }
export function update(id: string, input: UpdateStandardInput) { return requestData(StandardSchema, `/standards/${id}`, { method: 'PATCH', body: input, auth: true }); }
export function remove(id: string) { return requestVoid(`/standards/${id}`, { method: 'DELETE', auth: true }); }
export function submit(id: string) { return requestData(StandardSchema, `/standards/${id}/submit`, { method: 'POST', auth: true }); }
export function approve(id: string) { return requestData(StandardSchema, `/standards/${id}/approve`, { method: 'POST', auth: true }); }
export function deprecate(id: string) { return requestData(StandardSchema, `/standards/${id}/deprecate`, { method: 'POST', auth: true }); }
export function addRule(id: string, input: CreateStandardRuleInput) { return requestData(StandardSchema, `/standards/${id}/rules`, { method: 'POST', body: input, auth: true }); }
export function updateRule(id: string, ruleId: string, input: UpdateStandardRuleInput) { return requestData(StandardSchema, `/standards/${id}/rules/${ruleId}`, { method: 'PATCH', body: input, auth: true }); }
export function removeRule(id: string, ruleId: string) { return requestData(StandardSchema, `/standards/${id}/rules/${ruleId}`, { method: 'DELETE', auth: true }); }
export function linkPage(id: string, pageId: string) { return requestData(StandardSchema, `/standards/${id}/pages`, { method: 'POST', body: { pageId }, auth: true }); }
export function unlinkPage(id: string, pageId: string) { return requestData(StandardSchema, `/standards/${id}/pages/${pageId}`, { method: 'DELETE', auth: true }); }
export function requestException(id: string, input: RequestStandardExceptionInput) { return requestData(StandardSchema, `/standards/${id}/exceptions`, { method: 'POST', body: input, auth: true }); }
export function decideException(id: string, exceptionId: string, input: DecideStandardExceptionInput) { return requestData(StandardSchema, `/standards/${id}/exceptions/${exceptionId}`, { method: 'PATCH', body: input, auth: true }); }
export function versions(id: string, signal?: AbortSignal) { return requestData(z.array(StandardVersionSchema), `/standards/${id}/versions`, { signal, auth: true }); }
