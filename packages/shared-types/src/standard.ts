import { z } from 'zod';
import { KnowledgeSensitivitySchema } from './note';

export const StandardStatusSchema = z.enum(['draft', 'review', 'active', 'deprecated']);
export type StandardStatus = z.infer<typeof StandardStatusSchema>;
export const StandardPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type StandardPriority = z.infer<typeof StandardPrioritySchema>;
export const StandardRuleTypeSchema = z.enum(['must', 'should', 'may', 'must_not']);
export type StandardRuleType = z.infer<typeof StandardRuleTypeSchema>;
export const StandardExceptionStatusSchema = z.enum(['requested', 'approved', 'rejected', 'expired']);
export type StandardExceptionStatus = z.infer<typeof StandardExceptionStatusSchema>;

const UserRefSchema = z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string().email() });
const CategoryRefSchema = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() });
const PageRefSchema = z.object({ id: z.string().uuid(), title: z.string(), slug: z.string() });

export const StandardRuleSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  type: StandardRuleTypeSchema,
  sortOrder: z.number().int(),
  minVcpu: z.number().int().positive().nullable(),
  minRamMb: z.number().int().positive().nullable(),
  backupRequired: z.boolean().nullable(),
  allowedPorts: z.array(z.number().int().min(1).max(65535)),
  allowedNetworks: z.array(z.string()),
  namingConvention: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StandardRule = z.infer<typeof StandardRuleSchema>;

export const CreateStandardRuleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional(),
  type: StandardRuleTypeSchema.default('must'),
  sortOrder: z.number().int().default(0),
  minVcpu: z.number().int().positive().nullable().optional(),
  minRamMb: z.number().int().positive().nullable().optional(),
  backupRequired: z.boolean().nullable().optional(),
  allowedPorts: z.array(z.number().int().min(1).max(65535)).default([]),
  allowedNetworks: z.array(z.string().trim().min(1).max(100)).default([]),
  namingConvention: z.string().trim().max(500).nullable().optional(),
});
export type CreateStandardRuleInput = z.input<typeof CreateStandardRuleSchema>;
export const UpdateStandardRuleSchema = CreateStandardRuleSchema.partial();
export type UpdateStandardRuleInput = z.input<typeof UpdateStandardRuleSchema>;

export const StandardExceptionSchema = z.object({
  id: z.string().uuid(), reason: z.string(), status: StandardExceptionStatusSchema,
  expiresAt: z.string().datetime().nullable(), decisionNote: z.string().nullable(),
  requestedBy: UserRefSchema, responsible: UserRefSchema,
  decidedBy: UserRefSchema.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type StandardException = z.infer<typeof StandardExceptionSchema>;

export const StandardAssessmentSchema = z.object({
  confidence: z.number().min(0).max(1), reason: z.string(),
  qualityScore: z.number().min(0).max(1).nullable(), maturityScore: z.number().min(0).max(1).nullable(),
  sensitivity: KnowledgeSensitivitySchema.nullable(), contradictions: z.array(z.string()),
  suggestedTitle: z.string().nullable(), suggestedTags: z.array(z.string()),
  suggestedCategoryId: z.string().uuid().nullable(), conversionSuggestion: z.string().nullable(),
  assessedAt: z.string().datetime(),
});

export const StandardSchema = z.object({
  id: z.string().uuid(), title: z.string(), slug: z.string(), description: z.string(), justification: z.string(),
  spaceId: z.string().uuid(),
  status: StandardStatusSchema, priority: StandardPrioritySchema, version: z.number().int().positive(),
  mcpVisible: z.boolean(), validFrom: z.string().datetime().nullable(), validUntil: z.string().datetime().nullable(),
  knowledgeType: z.literal('standard'), knowledgePriority: z.literal(1),
  categoryId: z.string().uuid().nullable(), category: CategoryRefSchema.nullable(),
  createdBy: UserRefSchema, responsible: UserRefSchema,
  rules: z.array(StandardRuleSchema), pages: z.array(PageRefSchema), exceptions: z.array(StandardExceptionSchema),
  assessment: StandardAssessmentSchema.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Standard = z.infer<typeof StandardSchema>;

export const CreateStandardSchema = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(50_000),
  spaceId: z.string().uuid().optional(),
  justification: z.string().trim().min(1).max(20_000), priority: StandardPrioritySchema.default('medium'),
  categoryId: z.string().uuid().nullable().optional(), responsibleId: z.string().uuid(),
  validFrom: z.string().datetime().nullable().optional(), validUntil: z.string().datetime().nullable().optional(),
  mcpVisible: z.boolean().default(false), pageIds: z.array(z.string().uuid()).default([]),
  rules: z.array(CreateStandardRuleSchema).default([]),
});
export type CreateStandardInput = z.input<typeof CreateStandardSchema>;
export const UpdateStandardSchema = CreateStandardSchema.omit({ rules: true, pageIds: true }).partial();
export type UpdateStandardInput = z.input<typeof UpdateStandardSchema>;

export const StandardQuerySchema = z.object({
  spaceId: z.string().uuid().optional(),
  status: StandardStatusSchema.optional(), priority: StandardPrioritySchema.optional(),
  categoryId: z.string().uuid().optional(), q: z.string().trim().max(200).optional(),
});
export type StandardQuery = z.infer<typeof StandardQuerySchema>;

export const RequestStandardExceptionSchema = z.object({
  reason: z.string().trim().min(1).max(10_000), responsibleId: z.string().uuid(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type RequestStandardExceptionInput = z.input<typeof RequestStandardExceptionSchema>;
export const DecideStandardExceptionSchema = z.object({
  status: z.enum(['approved', 'rejected']), decisionNote: z.string().trim().max(10_000).optional(),
});
export type DecideStandardExceptionInput = z.input<typeof DecideStandardExceptionSchema>;
export const LinkStandardPageSchema = z.object({ pageId: z.string().uuid() });
export type LinkStandardPageInput = z.infer<typeof LinkStandardPageSchema>;

export const StandardVersionSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), snapshot: z.record(z.unknown()),
  author: UserRefSchema, createdAt: z.string().datetime(),
});
export type StandardVersion = z.infer<typeof StandardVersionSchema>;
