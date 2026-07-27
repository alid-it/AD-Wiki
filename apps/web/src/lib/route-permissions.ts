import type { Action, Resource } from '@ad-wiki/shared-types';

export interface RoutePermission {
  resource: Resource;
  action: Action;
}

export interface RouteAccessPolicy {
  mode: 'all' | 'any';
  permissions: RoutePermission[];
}

const read = (resource: Resource): RoutePermission => ({ resource, action: 'read' });

const SETTINGS_POLICIES: Array<[prefix: string, policy: RouteAccessPolicy]> = [
  ['/settings/mcp/authorize', { mode: 'all', permissions: [read('mcp')] }],
  ['/settings/system-info', { mode: 'all', permissions: [read('system_info')] }],
  ['/settings/integrations', { mode: 'all', permissions: [read('integrations')] }],
  ['/settings/audit-logs', { mode: 'all', permissions: [read('audit_logs')] }],
  ['/settings/categories', { mode: 'all', permissions: [read('categories')] }],
  ['/settings/api-keys', { mode: 'all', permissions: [read('api_keys')] }],
  ['/settings/backups', { mode: 'all', permissions: [read('backups')] }],
  ['/settings/folders', { mode: 'all', permissions: [read('pages')] }],
  ['/settings/media', { mode: 'all', permissions: [read('media')] }],
  ['/settings/spaces', { mode: 'all', permissions: [read('spaces')] }],
  ['/settings/users', { mode: 'all', permissions: [read('users')] }],
  ['/settings/roles', { mode: 'all', permissions: [read('roles')] }],
  ['/settings/smtp', { mode: 'all', permissions: [read('smtp')] }],
  ['/settings/mcp', { mode: 'all', permissions: [read('mcp')] }],
  [
    '/settings/setup',
    {
      mode: 'any',
      permissions: [
        ...(
          [
          'mcp',
          'integrations',
          'backups',
          'settings',
          'system_info',
          'roles',
          'groups',
          'spaces',
          'resource_acls',
          ] as const
        ).map(read),
        { resource: 'groups', action: 'manage_members' },
      ],
    },
  ],
];

/**
 * Zentrale Frontend-Richtlinie für alle geschützten App-Routen.
 * Aktionsrouten stehen vor ihren allgemeineren Lesepfaden.
 */
export function getRouteAccessPolicy(pathname: string): RouteAccessPolicy | null {
  if (pathname === '/wiki/new') {
    return { mode: 'all', permissions: [{ resource: 'pages', action: 'create' }] };
  }
  if (/^\/wiki\/[^/]+\/edit$/.test(pathname)) {
    return { mode: 'all', permissions: [{ resource: 'pages', action: 'update' }] };
  }
  if (pathname === '/wiki/trash') {
    return { mode: 'all', permissions: [{ resource: 'pages', action: 'update' }] };
  }
  if (pathname === '/wiki' || pathname.startsWith('/wiki/')) {
    return { mode: 'all', permissions: [read('pages')] };
  }
  if (pathname === '/notes' || pathname.startsWith('/notes/')) {
    return { mode: 'all', permissions: [read('notes')] };
  }
  if (pathname === '/standards' || pathname.startsWith('/standards/')) {
    return { mode: 'all', permissions: [read('standards')] };
  }
  if (pathname === '/media' || pathname.startsWith('/media/')) {
    return { mode: 'all', permissions: [read('media')] };
  }
  if (pathname === '/search') {
    return {
      mode: 'any',
      permissions: (['pages', 'notes', 'standards', 'media'] as const).map(read),
    };
  }
  if (pathname === '/settings') {
    return { mode: 'all', permissions: [read('settings')] };
  }
  const setting = SETTINGS_POLICIES.find(([prefix]) => pathname.startsWith(prefix));
  return setting?.[1] ?? null;
}

export function mayAccessRoute(
  policy: RouteAccessPolicy | null,
  hasPermission: (resource: Resource, action: Action) => boolean,
): boolean {
  if (!policy) return true;
  const checks = policy.permissions.map(({ resource, action }) =>
    hasPermission(resource, action),
  );
  return policy.mode === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}
