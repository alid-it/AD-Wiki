import { z } from 'zod';
import { KnowledgeKindSchema } from './note';

export const SpaceVisibilitySchema = z.enum(['open', 'restricted']);
export type SpaceVisibility = z.infer<typeof SpaceVisibilitySchema>;

export const SpaceGroupRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});
export type SpaceGroupRef = z.infer<typeof SpaceGroupRefSchema>;

export const KnowledgeSpaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(120),
  description: z.string().max(500).nullable(),
  visibility: SpaceVisibilitySchema,
  enabledKinds: z.array(KnowledgeKindSchema).min(1),
  isSystem: z.boolean(),
  responsibleGroupId: z.string().uuid().nullable(),
  responsibleGroup: SpaceGroupRefSchema.nullable(),
  categoryCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
  noteCount: z.number().int().nonnegative(),
  standardCount: z.number().int().nonnegative(),
  contentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KnowledgeSpace = z.infer<typeof KnowledgeSpaceSchema>;

export const CreateKnowledgeSpaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullable().optional(),
  visibility: SpaceVisibilitySchema.default('open'),
  enabledKinds: z.array(KnowledgeKindSchema).min(1).default(['wiki']),
  responsibleGroupId: z.string().uuid().nullable().optional(),
});
export type CreateKnowledgeSpaceInput = z.input<typeof CreateKnowledgeSpaceSchema>;

export const UpdateKnowledgeSpaceSchema = CreateKnowledgeSpaceSchema.partial();
export type UpdateKnowledgeSpaceInput = z.input<typeof UpdateKnowledgeSpaceSchema>;
