import { z } from 'zod';

export const NoteStatusSchema = z.enum(['captured', 'promoted', 'archived']);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;

export const NoteSharePermissionSchema = z.enum(['view', 'edit']);
export type NoteSharePermission = z.infer<typeof NoteSharePermissionSchema>;

export const KnowledgeKindSchema = z.enum(['note', 'wiki', 'standard']);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

export const KnowledgeSensitivitySchema = z.enum(['low', 'medium', 'high']);
export type KnowledgeSensitivity = z.infer<typeof KnowledgeSensitivitySchema>;

export const NoteUserRefSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  email: z.string().email(),
});

export const NoteCategoryRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export const NoteShareSchema = z.object({
  user: NoteUserRefSchema,
  permission: NoteSharePermissionSchema,
  sharedAt: z.string().datetime(),
});
export type NoteShare = z.infer<typeof NoteShareSchema>;

export const NoteAssessmentSchema = z.object({
  suggestedType: KnowledgeKindSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().nullable(),
  qualityScore: z.number().min(0).max(1).nullable(),
  maturityScore: z.number().min(0).max(1).nullable(),
  sensitivity: KnowledgeSensitivitySchema.nullable(),
  assessedAt: z.string().datetime(),
}).nullable();

export const NoteSchema = z.object({
  id: z.string().uuid(),
  spaceId: z.string().uuid().nullable(),
  title: z.string().max(200).nullable(),
  content: z.string().min(1),
  status: NoteStatusSchema,
  mcpVisible: z.boolean(),
  knowledgeType: z.literal('note'),
  knowledgePriority: z.literal(3),
  ownerId: z.string().uuid(),
  owner: NoteUserRefSchema,
  categoryId: z.string().uuid().nullable(),
  category: NoteCategoryRefSchema.nullable(),
  tags: z.array(z.string()),
  shares: z.array(NoteShareSchema),
  isOwner: z.boolean(),
  sharePermission: NoteSharePermissionSchema.nullable(),
  promotedPageId: z.string().uuid().nullable(),
  assessment: NoteAssessmentSchema,
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Note = z.infer<typeof NoteSchema>;

const NoteTagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);

export const CreateNoteSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  content: z.string().trim().min(1).max(100_000),
  spaceId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  tags: NoteTagsSchema.default([]),
  mcpVisible: z.boolean().default(false),
});
export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

export const UpdateNoteSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  content: z.string().trim().min(1).max(100_000).optional(),
  spaceId: z.string().uuid().nullable().optional(),
  status: NoteStatusSchema.optional(),
  categoryId: z.string().uuid().nullable().optional(),
  tags: NoteTagsSchema.optional(),
  mcpVisible: z.boolean().optional(),
});
export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;

export const NoteScopeSchema = z.enum(['all', 'mine', 'shared']).default('all');
export type NoteScope = z.infer<typeof NoteScopeSchema>;
export const NoteQuerySchema = z.object({
  spaceId: z.string().uuid().optional(),
  scope: NoteScopeSchema,
  status: NoteStatusSchema.optional(),
  q: z.string().trim().max(200).optional(),
});
export type NoteQuery = z.infer<typeof NoteQuerySchema>;

export const ShareNoteSchema = z.object({
  userId: z.string().uuid(),
  permission: NoteSharePermissionSchema.default('view'),
});
export type ShareNoteInput = z.infer<typeof ShareNoteSchema>;

export const PromoteNoteSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
});
export type PromoteNoteInput = z.infer<typeof PromoteNoteSchema>;
