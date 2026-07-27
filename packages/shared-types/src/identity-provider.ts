import { z } from 'zod';

export const IdentityProviderTypeSchema = z.enum([
  'GENERIC_OIDC',
  'MICROSOFT_ENTRA',
  'KEYCLOAK',
]);
export type IdentityProviderType = z.infer<typeof IdentityProviderTypeSchema>;

export const IdentityProviderSyncModeSchema = z.enum(['ADD_ONLY', 'MANAGED']);
export type IdentityProviderSyncMode = z.infer<
  typeof IdentityProviderSyncModeSchema
>;

export const EntraGraphMembershipModeSchema = z.enum([
  'DIRECT',
  'TRANSITIVE',
]);
export type EntraGraphMembershipMode = z.infer<
  typeof EntraGraphMembershipModeSchema
>;

export const IdentityProviderClientAuthMethodSchema = z.enum([
  'NONE',
  'CLIENT_SECRET_POST',
  'CLIENT_SECRET_BASIC',
]);
export type IdentityProviderClientAuthMethod = z.infer<
  typeof IdentityProviderClientAuthMethodSchema
>;

export const IdentityProviderRoleMappingSourceSchema = z.enum([
  'GROUP',
  'ROLE',
]);
export type IdentityProviderRoleMappingSource = z.infer<
  typeof IdentityProviderRoleMappingSourceSchema
>;

const ClaimPathSchema = z.string().trim().min(1).max(200);
const OptionalClaimPathSchema = ClaimPathSchema.nullable().optional();
const OidcScopeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:/-]+$/, 'Der Scope enthält ungültige Zeichen.');

/** Providerabhängige Claims, die auf das interne Benutzerprofil abgebildet werden. */
export const IdentityProviderClaimMappingSchema = z
  .object({
    subject: ClaimPathSchema.default('sub'),
    email: ClaimPathSchema.default('email'),
    emailVerified: ClaimPathSchema.default('email_verified'),
    username: ClaimPathSchema.default('preferred_username'),
    displayName: ClaimPathSchema.default('name'),
  })
  .strict();
export type IdentityProviderClaimMapping = z.infer<
  typeof IdentityProviderClaimMappingSchema
>;

/** Normalisiertes Profil, das nach Claim-Auswertung für Link und JIT gilt. */
export const OidcProvisioningProfileSchema = z
  .object({
    subject: z.string().trim().min(1).max(1000),
    email: z.string().trim().max(254).email(),
    username: z.string().trim().min(1).max(500),
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();
export type OidcProvisioningProfile = z.infer<
  typeof OidcProvisioningProfileSchema
>;

const IdentityProviderConfigurationFields = {
  name: z.string().trim().min(2).max(100),
  type: IdentityProviderTypeSchema.default('GENERIC_OIDC'),
  issuer: z.string().trim().url().max(2000),
  discoveryUrl: z.string().trim().url().max(2000).nullable().optional(),
  clientId: z.string().trim().min(1).max(500),
  clientAuthMethod: IdentityProviderClientAuthMethodSchema.default(
    'CLIENT_SECRET_POST',
  ),
  scopes: z
    .array(OidcScopeSchema)
    .min(1)
    .max(20)
    .default(['openid', 'profile', 'email'])
    .refine((scopes) => scopes.includes('openid'), {
      message: 'Der Scope openid ist zwingend erforderlich.',
    }),
  claimMapping: IdentityProviderClaimMappingSchema.default({
    subject: 'sub',
    email: 'email',
    emailVerified: 'email_verified',
    username: 'preferred_username',
    displayName: 'name',
  }),
  isActive: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
  allowJitProvisioning: z.boolean().default(false),
  defaultRoleId: z.string().uuid().nullable().optional(),
  groupSyncMode: IdentityProviderSyncModeSchema.default('ADD_ONLY'),
  groupClaim: OptionalClaimPathSchema,
  roleClaim: OptionalClaimPathSchema,
  allowAdminRoleMapping: z.boolean().default(false),
  maxSessionAgeMinutes: z.number().int().min(5).max(10_080).default(480),
  entraGraphFallbackEnabled: z.boolean().default(false),
  entraGraphMembershipMode:
    EntraGraphMembershipModeSchema.default('TRANSITIVE'),
  entraGraphCacheTtlMinutes: z.number().int().min(1).max(60).default(15),
} as const;

export const CreateIdentityProviderSchema = z
  .object({
    ...IdentityProviderConfigurationFields,
    clientSecret: z.string().min(1).max(4000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.entraGraphFallbackEnabled &&
      input.type !== 'MICROSOFT_ENTRA'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entraGraphFallbackEnabled'],
        message:
          'Der Microsoft-Graph-Fallback ist nur für Entra-Provider zulässig.',
      });
    }
    if (input.entraGraphFallbackEnabled && !input.groupClaim) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupClaim'],
        message:
          'Für den Microsoft-Graph-Fallback muss ein Gruppen-Claim konfiguriert sein.',
      });
    }
    if (
      input.entraGraphFallbackEnabled &&
      !input.scopes.some(
        (scope) =>
          scope.toLowerCase() === 'user.read' ||
          scope.toLowerCase() ===
            'https://graph.microsoft.com/user.read',
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopes'],
        message:
          'Der Microsoft-Graph-Fallback benötigt den delegierten Scope User.Read.',
      });
    }
  });
export type CreateIdentityProviderInput = z.infer<
  typeof CreateIdentityProviderSchema
>;

export const UpdateIdentityProviderSchema = z
  .object({
    name: IdentityProviderConfigurationFields.name.optional(),
    type: IdentityProviderTypeSchema.optional(),
    issuer: IdentityProviderConfigurationFields.issuer.optional(),
    discoveryUrl:
      IdentityProviderConfigurationFields.discoveryUrl.optional(),
    clientId: IdentityProviderConfigurationFields.clientId.optional(),
    clientAuthMethod: IdentityProviderClientAuthMethodSchema.optional(),
    clientSecret: z.string().min(1).max(4000).optional(),
    clearClientSecret: z.boolean().optional(),
    scopes: IdentityProviderConfigurationFields.scopes.optional(),
    claimMapping: IdentityProviderClaimMappingSchema.optional(),
    isActive: z.boolean().optional(),
    displayOrder: IdentityProviderConfigurationFields.displayOrder.optional(),
    allowJitProvisioning: z.boolean().optional(),
    defaultRoleId: z.string().uuid().nullable().optional(),
    groupSyncMode: IdentityProviderSyncModeSchema.optional(),
    groupClaim: OptionalClaimPathSchema,
    roleClaim: OptionalClaimPathSchema,
    allowAdminRoleMapping: z.boolean().optional(),
    maxSessionAgeMinutes:
      IdentityProviderConfigurationFields.maxSessionAgeMinutes.optional(),
    entraGraphFallbackEnabled: z.boolean().optional(),
    entraGraphMembershipMode: EntraGraphMembershipModeSchema.optional(),
    entraGraphCacheTtlMinutes:
      IdentityProviderConfigurationFields.entraGraphCacheTtlMinutes.optional(),
    confirmLastActiveProvider: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      Object.values(input).some((value) => value !== undefined) &&
      !(input.clientSecret && input.clearClientSecret),
    {
      message:
        'Es muss mindestens ein Feld geändert werden; Client-Secret setzen und löschen schließen sich aus.',
    },
  );
export type UpdateIdentityProviderInput = z.infer<
  typeof UpdateIdentityProviderSchema
>;

/** Sichere Providerantwort ohne gespeichertes Client-Secret. */
export const IdentityProviderSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().min(2).max(120),
    name: z.string().min(2).max(100),
    type: IdentityProviderTypeSchema,
    issuer: z.string().url(),
    discoveryUrl: z.string().url().nullable(),
    clientId: z.string().min(1).max(500),
    clientAuthMethod: IdentityProviderClientAuthMethodSchema,
    clientSecretConfigured: z.boolean(),
    scopes: z.array(OidcScopeSchema),
    claimMapping: IdentityProviderClaimMappingSchema,
    isActive: z.boolean(),
    displayOrder: z.number().int().nonnegative(),
    allowJitProvisioning: z.boolean(),
    defaultRoleId: z.string().uuid().nullable(),
    groupSyncMode: IdentityProviderSyncModeSchema,
    groupClaim: ClaimPathSchema.nullable(),
    roleClaim: ClaimPathSchema.nullable(),
    allowAdminRoleMapping: z.boolean(),
    maxSessionAgeMinutes: z.number().int().positive(),
    entraGraphFallbackEnabled: z.boolean(),
    entraGraphMembershipMode: EntraGraphMembershipModeSchema,
    entraGraphCacheTtlMinutes: z.number().int().min(1).max(60),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;

export const DeleteIdentityProviderSchema = z
  .object({
    confirmLastActiveProvider: z.boolean().default(false),
  })
  .strict();
export type DeleteIdentityProviderInput = z.infer<
  typeof DeleteIdentityProviderSchema
>;

export const IdentityProviderAdminSchema = IdentityProviderSchema.extend({
  counts: z
    .object({
      identities: z.number().int().nonnegative(),
      groupMappings: z.number().int().nonnegative(),
      roleMappings: z.number().int().nonnegative(),
    })
    .strict(),
});
export type IdentityProviderAdmin = z.infer<
  typeof IdentityProviderAdminSchema
>;

export const IdentityProviderConnectionCheckNameSchema = z.enum([
  'DISCOVERY',
  'TLS',
  'ISSUER',
  'JWKS',
  'AUTHORIZATION_ENDPOINT',
  'TOKEN_ENDPOINT',
  'PKCE',
]);
export type IdentityProviderConnectionCheckName = z.infer<
  typeof IdentityProviderConnectionCheckNameSchema
>;

export const IdentityProviderConnectionCheckSchema = z
  .object({
    name: IdentityProviderConnectionCheckNameSchema,
    ok: z.boolean(),
    message: z.string().min(1).max(500),
  })
  .strict();
export type IdentityProviderConnectionCheck = z.infer<
  typeof IdentityProviderConnectionCheckSchema
>;

/** Geheimnisfreie Diagnose der öffentlich erreichbaren OIDC-Metadaten. */
export const IdentityProviderConnectionTestSchema = z
  .object({
    providerId: z.string().uuid(),
    ok: z.boolean(),
    testedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    discoveryUrl: z.string().url(),
    issuer: z.string().url(),
    checks: z.array(IdentityProviderConnectionCheckSchema).min(7).max(7),
    logout: z
      .object({
        endSessionEndpoint: z.boolean(),
        frontchannel: z.boolean(),
        backchannel: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type IdentityProviderConnectionTest = z.infer<
  typeof IdentityProviderConnectionTestSchema
>;

export const ExternalIdentitySchema = z
  .object({
    id: z.string().uuid(),
    providerId: z.string().uuid(),
    userId: z.string().uuid(),
    issuer: z.string().url(),
    subject: z.string().min(1).max(1000),
    email: z.string().email().nullable(),
    username: z.string().max(500).nullable(),
    displayName: z.string().max(500).nullable(),
    lastLoginAt: z.string().datetime().nullable(),
    lastGroupSyncAt: z.string().datetime().nullable(),
    lastSyncErrorCode: z.string().max(200).nullable(),
    lastGroupClaims: z
      .array(z.string().min(1).max(2000))
      .max(500)
      .default([]),
    lastRoleClaims: z
      .array(z.string().min(1).max(2000))
      .max(500)
      .default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ExternalIdentity = z.infer<typeof ExternalIdentitySchema>;

export const CreateIdentityProviderGroupMappingSchema = z
  .object({
    externalGroupId: z.string().trim().min(1).max(1000),
    externalGroupPath: z.string().trim().min(1).max(2000).nullable().optional(),
    externalGroupName: z.string().trim().min(1).max(500).nullable().optional(),
    groupId: z.string().uuid(),
  })
  .strict();
export type CreateIdentityProviderGroupMappingInput = z.infer<
  typeof CreateIdentityProviderGroupMappingSchema
>;

export const IdentityProviderGroupMappingSchema =
  CreateIdentityProviderGroupMappingSchema.extend({
    id: z.string().uuid(),
    providerId: z.string().uuid(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
export type IdentityProviderGroupMapping = z.infer<
  typeof IdentityProviderGroupMappingSchema
>;

export const CreateIdentityProviderRoleMappingSchema = z
  .object({
    source: IdentityProviderRoleMappingSourceSchema,
    externalValue: z.string().trim().min(1).max(1000),
    roleId: z.string().uuid(),
    priority: z.number().int().min(0).max(10_000),
  })
  .strict();
export type CreateIdentityProviderRoleMappingInput = z.infer<
  typeof CreateIdentityProviderRoleMappingSchema
>;

export const IdentityProviderRoleMappingSchema =
  CreateIdentityProviderRoleMappingSchema.extend({
    id: z.string().uuid(),
    providerId: z.string().uuid(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
export type IdentityProviderRoleMapping = z.infer<
  typeof IdentityProviderRoleMappingSchema
>;

export const IdentityProviderDetailsSchema = z
  .object({
    provider: IdentityProviderAdminSchema,
    groupMappings: z.array(IdentityProviderGroupMappingSchema),
    roleMappings: z.array(IdentityProviderRoleMappingSchema),
  })
  .strict();
export type IdentityProviderDetails = z.infer<
  typeof IdentityProviderDetailsSchema
>;

export const IdentityProviderReferenceDataSchema = z
  .object({
    groups: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string().min(1).max(100),
        })
        .strict(),
    ),
    roles: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string().min(1).max(100),
          isSystem: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type IdentityProviderReferenceData = z.infer<
  typeof IdentityProviderReferenceDataSchema
>;

export const IdentitySyncStatusSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    userDisplayName: z.string().min(1).max(100),
    userActive: z.boolean(),
    email: z.string().email().nullable(),
    username: z.string().max(500).nullable(),
    lastLoginAt: z.string().datetime().nullable(),
    lastGroupSyncAt: z.string().datetime().nullable(),
    lastSyncErrorCode: z.string().max(200).nullable(),
    groupClaimCount: z.number().int().nonnegative(),
    roleClaimCount: z.number().int().nonnegative(),
  })
  .strict();
export type IdentitySyncStatus = z.infer<typeof IdentitySyncStatusSchema>;

export const IdentitySyncHistoryEntrySchema = z
  .object({
    id: z.string().uuid(),
    externalIdentityId: z.string().uuid(),
    action: z.enum(['identity.groups_synced', 'identity.sync_failed']),
    createdAt: z.string().datetime(),
    details: z.record(z.unknown()).nullable(),
  })
  .strict();
export type IdentitySyncHistoryEntry = z.infer<
  typeof IdentitySyncHistoryEntrySchema
>;

const IdentitySyncClaimsSchema = z
  .record(z.string().min(1).max(200), z.unknown())
  .refine(
    (claims) => {
      try {
        return JSON.stringify(claims).length <= 100_000;
      } catch {
        return false;
      }
    },
    'Der Beispielsatz von Claims ist zu groß oder nicht serialisierbar.',
  );

/** Schreibfreie Vorschau eines Gruppen- und Rollenabgleichs. */
export const IdentitySyncPreviewInputSchema = z
  .object({
    externalIdentityId: z.string().uuid(),
    claims: IdentitySyncClaimsSchema,
  })
  .strict();
export type IdentitySyncPreviewInput = z.infer<
  typeof IdentitySyncPreviewInputSchema
>;

export const IdentitySyncGroupChangeSchema = z
  .object({
    mappingId: z.string().uuid(),
    groupId: z.string().uuid(),
    groupName: z.string().min(1).max(100),
    externalValue: z.string().min(1).max(2000),
  })
  .strict();
export type IdentitySyncGroupChange = z.infer<
  typeof IdentitySyncGroupChangeSchema
>;

export const IdentitySyncRoleChangeSchema = z
  .object({
    mappingId: z.string().uuid(),
    roleId: z.string().uuid(),
    roleName: z.string().min(1).max(100),
    priority: z.number().int().min(0).max(10_000),
    source: IdentityProviderRoleMappingSourceSchema,
    externalValue: z.string().min(1).max(2000),
  })
  .strict();
export type IdentitySyncRoleChange = z.infer<
  typeof IdentitySyncRoleChangeSchema
>;

export const IdentitySyncPreviewSchema = z
  .object({
    providerId: z.string().uuid(),
    externalIdentityId: z.string().uuid(),
    userId: z.string().uuid(),
    mode: IdentityProviderSyncModeSchema,
    normalizedClaims: z
      .object({
        groups: z.array(z.string().min(1).max(2000)).max(500),
        roles: z.array(z.string().min(1).max(2000)).max(500),
      })
      .strict(),
    groups: z
      .object({
        add: z.array(IdentitySyncGroupChangeSchema),
        keep: z.array(IdentitySyncGroupChangeSchema),
        remove: z.array(IdentitySyncGroupChangeSchema),
        ignoredValues: z.array(z.string().min(1).max(2000)).max(500),
      })
      .strict(),
    role: z
      .object({
        current: IdentitySyncRoleChangeSchema.nullable(),
        next: IdentitySyncRoleChangeSchema.nullable(),
        changed: z.boolean(),
        ignoredValues: z.array(z.string().min(1).max(2000)).max(500),
      })
      .strict(),
  })
  .strict();
export type IdentitySyncPreview = z.infer<
  typeof IdentitySyncPreviewSchema
>;

/** Öffentlich sichtbarer Provider auf der Loginseite. */
export const OidcLoginProviderSchema = z
  .object({
    slug: z.string().min(2).max(120),
    name: z.string().min(2).max(100),
    type: IdentityProviderTypeSchema,
  })
  .strict();
export type OidcLoginProvider = z.infer<typeof OidcLoginProviderSchema>;

/** Externe Identität in der sicheren Profilansicht. */
export const LinkedExternalIdentitySchema = z
  .object({
    id: z.string().uuid(),
    provider: OidcLoginProviderSchema,
    email: z.string().email().nullable(),
    username: z.string().max(500).nullable(),
    displayName: z.string().max(500).nullable(),
    lastLoginAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type LinkedExternalIdentity = z.infer<
  typeof LinkedExternalIdentitySchema
>;

/** Ziel-URL eines authentifizierten Verknüpfungs- oder Trennvorgangs. */
export const OidcAccountActionStartSchema = z
  .object({
    authorizationUrl: z.string().url(),
  })
  .strict();
export type OidcAccountActionStart = z.infer<
  typeof OidcAccountActionStartSchema
>;

/** Tauscht einen kurzlebigen OIDC-Einmalcode gegen die interne Sitzung. */
export const ExchangeOidcLoginCodeSchema = z
  .object({
    code: z.string().min(43).max(512),
  })
  .strict();
export type ExchangeOidcLoginCodeInput = z.infer<
  typeof ExchangeOidcLoginCodeSchema
>;
