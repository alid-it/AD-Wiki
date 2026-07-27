import { z } from 'zod';

/** Ressourcen, für die Rechte vergeben werden können. */
export const RESOURCES = [
  'pages',
  'categories',
  'media',
  'notes',
  'standards',
  'users',
  'settings',
  'roles',
  'user_permissions',
  'audit_logs',
  'api_keys',
  'smtp',
  'system_info',
  'exports',
  'mcp',
  'integrations',
  'backups',
  'groups',
  'spaces',
  'resource_acls',
  'identity_providers',
  'identity_mappings',
  'identity_sync',
] as const;
export const ResourceSchema = z.enum(RESOURCES);
export type Resource = z.infer<typeof ResourceSchema>;

/** Aktionen, die auf einer Ressource erlaubt/verboten werden können. */
export const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'share',
  'approve',
  'run',
  'restore',
  'assign_role',
  'reset_password',
  'purge',
  'test',
  'manage_members',
] as const;
export const ActionSchema = z.enum(ACTIONS);
export type Action = z.infer<typeof ActionSchema>;

/**
 * Expliziter Rechtekatalog. Nur hier aufgeführte Kombinationen erscheinen in
 * Rollen, individuellen Overrides und API-Key-Rechten.
 */
export const PERMISSION_CATALOG = {
  pages: ['create', 'read', 'update', 'delete', 'purge'],
  categories: ['create', 'read', 'update', 'delete'],
  media: ['create', 'read', 'update', 'delete'],
  notes: ['create', 'read', 'update', 'delete', 'share'],
  standards: ['create', 'read', 'update', 'delete', 'approve'],
  users: ['create', 'read', 'update', 'delete', 'assign_role', 'reset_password'],
  settings: ['read', 'update'],
  roles: ['create', 'read', 'update', 'delete'],
  user_permissions: ['read', 'update'],
  audit_logs: ['read'],
  api_keys: ['read'],
  smtp: ['read', 'update', 'test'],
  system_info: ['read'],
  exports: ['run'],
  mcp: ['create', 'read', 'delete'],
  integrations: ['create', 'read', 'update', 'delete'],
  backups: ['create', 'read', 'update', 'delete', 'run', 'restore'],
  groups: ['create', 'read', 'update', 'delete', 'manage_members'],
  spaces: ['create', 'read', 'update', 'delete'],
  resource_acls: ['read', 'update'],
  identity_providers: ['read', 'update'],
  identity_mappings: ['read', 'update'],
  identity_sync: ['read', 'update'],
} as const satisfies Record<Resource, readonly Action[]>;

/** Prüft eine Kombination ausschließlich gegen den zentralen Rechtekatalog. */
export function isPermissionSupported(resource: Resource, action: Action): boolean {
  return (PERMISSION_CATALOG[resource] as readonly Action[]).includes(action);
}

/** Ein einzelner Rechte-Eintrag (Rolle oder User). */
export const AclEntrySchema = z
  .object({
    resource: ResourceSchema,
    action: ActionSchema,
    allowed: z.boolean(),
  })
  .refine(({ resource, action }) => isPermissionSupported(resource, action), {
    message: 'Diese Kombination aus Ressource und Aktion wird nicht unterstützt.',
  });
export type AclEntry = z.infer<typeof AclEntrySchema>;

/** Rechte einer Rolle inkl. Rollen-Metadaten (Antwort von GET /acls). */
export const RoleAclSchema = z.object({
  roleId: z.string().uuid(),
  roleName: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  userCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  entries: z.array(AclEntrySchema),
});
export type RoleAcl = z.infer<typeof RoleAclSchema>;

/** Antwort von GET /acls: alle Rollen mit ihren Rechten plus die Matrix-Achsen. */
export const AclOverviewSchema = z.object({
  resources: z.array(ResourceSchema),
  actions: z.array(ActionSchema),
  roles: z.array(RoleAclSchema),
});
export type AclOverview = z.infer<typeof AclOverviewSchema>;

/** Eingabe zum kompletten Setzen der Rechte (Rolle oder User). */
export const SetAclSchema = z.array(AclEntrySchema);
export type SetAclInput = z.infer<typeof SetAclSchema>;
