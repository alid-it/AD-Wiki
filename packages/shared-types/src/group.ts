import { z } from 'zod';

/** Rolle eines Benutzers innerhalb genau einer Gruppe. */
export const GroupMembershipRoleSchema = z.enum(['MEMBER', 'MANAGER']);
export type GroupMembershipRole = z.infer<typeof GroupMembershipRoleSchema>;

/** Kompakte Gruppe für Listen, Auswahlfelder und Mitgliedschaften. */
export const GroupSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(120),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GroupSummary = z.infer<typeof GroupSummarySchema>;

/** Benutzerinformationen innerhalb einer Gruppenmitgliedschaft. */
export const GroupMemberUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(50),
  displayName: z.string().min(1).max(100),
  isActive: z.boolean(),
});
export type GroupMemberUser = z.infer<typeof GroupMemberUserSchema>;

/** Sichere Suchparameter für die gruppengebundene Mitgliederauswahl. */
export const GroupMemberCandidatesQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type GroupMemberCandidatesQuery = z.infer<
  typeof GroupMemberCandidatesQuerySchema
>;

/** Mitgliedschaft inklusive Benutzerinformationen für die Verwaltung. */
export const GroupMembershipSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  userId: z.string().uuid(),
  role: GroupMembershipRoleSchema,
  hasLocalGrant: z.boolean(),
  externalGrantCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  user: GroupMemberUserSchema,
});
export type GroupMembership = z.infer<typeof GroupMembershipSchema>;

/** Eigene Mitgliedschaft mit der zugehörigen Gruppe. */
export const OwnGroupMembershipSchema = z.object({
  id: z.string().uuid(),
  role: GroupMembershipRoleSchema,
  hasLocalGrant: z.boolean(),
  externalGrantCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  group: GroupSummarySchema,
});
export type OwnGroupMembership = z.infer<typeof OwnGroupMembershipSchema>;

export const CreateGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional().default(''),
  })
  .strict();
export type CreateGroupInput = z.infer<typeof CreateGroupSchema>;

export const UpdateGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.description !== undefined, {
    message: 'Es muss mindestens ein Feld geändert werden.',
  });
export type UpdateGroupInput = z.infer<typeof UpdateGroupSchema>;

export const AddGroupMemberSchema = z
  .object({
    userId: z.string().uuid(),
    role: GroupMembershipRoleSchema.optional().default('MEMBER'),
  })
  .strict();
export type AddGroupMemberInput = z.infer<typeof AddGroupMemberSchema>;

export const UpdateGroupMemberSchema = z
  .object({
    role: GroupMembershipRoleSchema,
  })
  .strict();
export type UpdateGroupMemberInput = z.infer<typeof UpdateGroupMemberSchema>;
