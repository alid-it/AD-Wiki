import { z } from 'zod';
import {
  ActionSchema,
  PERMISSION_CATALOG,
  isPermissionSupported,
  ResourceSchema,
} from './acl';

const MAX_API_KEY_PERMISSIONS = Object.values(PERMISSION_CATALOG)
  .reduce((total, actions) => total + actions.length, 0);

/** Optionale Allowlist, die einen API-Key enger als den zugehoerigen User begrenzt. */
export const ApiKeyPermissionSchema = z.object({
  resource: ResourceSchema,
  action: ActionSchema,
}).refine(
  ({ resource, action }) => isPermissionSupported(resource, action),
  { message: 'Diese Kombination aus Ressource und Aktion wird nicht unterstuetzt.' },
);
export type ApiKeyPermission = z.infer<typeof ApiKeyPermissionSchema>;

export const ApiKeyStatusSchema = z.enum(['active', 'inactive', 'expired']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

/** Sichere API-Key-Metadaten ohne Lookup- oder bcrypt-Hash. */
export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  permissions: z.array(ApiKeyPermissionSchema).nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  isActive: z.boolean(),
  status: ApiKeyStatusSchema,
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
  permissions: z
    .array(ApiKeyPermissionSchema)
    .max(MAX_API_KEY_PERMISSIONS)
    .nullable()
    .optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;

/** Der geheime Klartext ist ausschliesslich Teil dieser einmaligen Antwort. */
export const CreatedApiKeySchema = ApiKeySchema.extend({
  key: z.string().regex(/^ad_wiki_[A-Za-z0-9_-]{48}$/),
});
export type CreatedApiKey = z.infer<typeof CreatedApiKeySchema>;

export const AdminApiKeySchema = ApiKeySchema.extend({
  user: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    username: z.string(),
    email: z.string().email(),
  }),
});
export type AdminApiKey = z.infer<typeof AdminApiKeySchema>;
