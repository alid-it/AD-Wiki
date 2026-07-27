import { z } from 'zod';
import { ActionSchema, ResourceSchema } from './acl';

export const ResourceAclRecipientTypeSchema = z.enum(['user', 'group']);
export type ResourceAclRecipientType = z.infer<
  typeof ResourceAclRecipientTypeSchema
>;

export const ResourceAclTargetTypeSchema = z.enum([
  'space',
  'category',
  'page',
  'note',
  'standard',
]);
export type ResourceAclTargetType = z.infer<
  typeof ResourceAclTargetTypeSchema
>;

export const ResourceAclEffectSchema = z.enum(['allow', 'deny']);
export type ResourceAclEffect = z.infer<typeof ResourceAclEffectSchema>;

export const ResourceAclRecipientRefSchema = z.object({
  type: ResourceAclRecipientTypeSchema,
  id: z.string().uuid(),
  label: z.string(),
});
export type ResourceAclRecipientRef = z.infer<
  typeof ResourceAclRecipientRefSchema
>;

export const ResourceAclTargetRefSchema = z.object({
  type: ResourceAclTargetTypeSchema,
  id: z.string().uuid(),
  label: z.string(),
});
export type ResourceAclTargetRef = z.infer<typeof ResourceAclTargetRefSchema>;

export const ResourceAclEntrySchema = z.object({
  id: z.string().uuid(),
  recipient: ResourceAclRecipientRefSchema,
  target: ResourceAclTargetRefSchema,
  action: ActionSchema,
  effect: ResourceAclEffectSchema,
  inheritToChildren: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResourceAclEntry = z.infer<typeof ResourceAclEntrySchema>;

export const CreateResourceAclEntrySchema = z
  .object({
    recipientType: ResourceAclRecipientTypeSchema,
    recipientId: z.string().uuid(),
    targetType: ResourceAclTargetTypeSchema,
    targetId: z.string().uuid(),
    action: ActionSchema,
    effect: ResourceAclEffectSchema,
    inheritToChildren: z.boolean().default(true),
  })
  .strict();
export type CreateResourceAclEntryInput = z.input<
  typeof CreateResourceAclEntrySchema
>;

export const UpdateResourceAclEntrySchema = z
  .object({
    effect: ResourceAclEffectSchema.optional(),
    inheritToChildren: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.effect !== undefined || input.inheritToChildren !== undefined,
    { message: 'Es muss mindestens ein Feld geändert werden.' },
  );
export type UpdateResourceAclEntryInput = z.infer<
  typeof UpdateResourceAclEntrySchema
>;

export const ResourceAclListQuerySchema = z
  .object({
    targetType: ResourceAclTargetTypeSchema.optional(),
    targetId: z.string().uuid().optional(),
  })
  .refine(
    (query) =>
      (query.targetType === undefined) === (query.targetId === undefined),
    {
      message: 'targetType und targetId müssen gemeinsam angegeben werden.',
    },
  );
export type ResourceAclListQuery = z.infer<
  typeof ResourceAclListQuerySchema
>;

export const ResourceAclBoundarySchema = z.object({
  id: z.string().uuid(),
  target: ResourceAclTargetRefSchema,
  action: ActionSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResourceAclBoundary = z.infer<
  typeof ResourceAclBoundarySchema
>;

export const SetResourceAclBoundarySchema = z
  .object({
    targetType: ResourceAclTargetTypeSchema,
    targetId: z.string().uuid(),
    action: ActionSchema,
  })
  .strict();
export type SetResourceAclBoundaryInput = z.infer<
  typeof SetResourceAclBoundarySchema
>;

export const ResourceAccessReasonSchema = z.enum([
  'global_denied',
  'direct_user_allow',
  'direct_user_deny',
  'direct_group_allow',
  'direct_group_deny',
  'inherited_user_allow',
  'inherited_user_deny',
  'inherited_group_allow',
  'inherited_group_deny',
  'inheritance_boundary_open',
  'inheritance_boundary_restricted',
  'space_open',
  'space_restricted',
  'personal_owner',
  'personal_share',
  'personal_denied',
]);
export type ResourceAccessReason = z.infer<
  typeof ResourceAccessReasonSchema
>;

export const ResourceAccessDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: ResourceAccessReasonSchema,
  globalAllowed: z.boolean(),
  ruleId: z.string().uuid().nullable(),
  sourceTarget: ResourceAclTargetRefSchema.nullable(),
  evaluatedPath: z.array(ResourceAclTargetRefSchema),
  groupIds: z.array(z.string().uuid()),
});
export type ResourceAccessDecision = z.infer<
  typeof ResourceAccessDecisionSchema
>;

export const EvaluateResourceAccessSchema = z
  .object({
    userId: z.string().uuid(),
    resource: ResourceSchema,
    action: ActionSchema,
    targetType: ResourceAclTargetTypeSchema,
    targetId: z.string().uuid(),
  })
  .strict();
export type EvaluateResourceAccessInput = z.infer<
  typeof EvaluateResourceAccessSchema
>;
