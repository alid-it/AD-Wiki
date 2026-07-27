import { z } from 'zod';

export const IntegrationConnectionStatusSchema = z.enum([
  'disconnected',
  'active',
  'needs_reauth',
  'error',
]);
export type IntegrationConnectionStatus = z.infer<typeof IntegrationConnectionStatusSchema>;

export const MicrosoftConnectionSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  status: IntegrationConnectionStatusSchema,
  accountName: z.string().nullable(),
  scopes: z.array(z.string()),
  selectedListIds: z.array(z.string()),
  expiresAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type MicrosoftConnection = z.infer<typeof MicrosoftConnectionSchema>;

export const MicrosoftOAuthStartSchema = z.object({
  authorizationUrl: z.string().url(),
});
export type MicrosoftOAuthStart = z.infer<typeof MicrosoftOAuthStartSchema>;

export const MicrosoftTodoListSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  isOwner: z.boolean().nullable(),
  wellknownListName: z.string().nullable(),
  selected: z.boolean(),
});
export type MicrosoftTodoList = z.infer<typeof MicrosoftTodoListSchema>;

export const SelectMicrosoftTodoListsSchema = z.object({
  listIds: z.array(z.string().min(1)).max(100).transform((ids) => [...new Set(ids)]),
});
export type SelectMicrosoftTodoListsInput = z.infer<typeof SelectMicrosoftTodoListsSchema>;

export const IntegrationSyncRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['running', 'succeeded', 'failed']),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  updatedCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});
export type IntegrationSyncRun = z.infer<typeof IntegrationSyncRunSchema>;

export const CreateMicrosoftTodoTaskSchema = z.object({
  noteId: z.string().uuid(),
  listId: z.string().min(1).max(500),
});
export type CreateMicrosoftTodoTaskInput = z.infer<typeof CreateMicrosoftTodoTaskSchema>;

export const MicrosoftTodoTaskLinkSchema = z.object({
  mappingId: z.string().uuid(),
  noteId: z.string().uuid(),
  listId: z.string(),
  externalTaskId: z.string(),
  createdAt: z.string().datetime(),
});
export type MicrosoftTodoTaskLink = z.infer<typeof MicrosoftTodoTaskLinkSchema>;
