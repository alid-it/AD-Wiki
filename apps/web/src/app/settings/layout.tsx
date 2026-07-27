'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  SlidersHorizontal,
  FolderTree,
  Folder,
  Users,
  ShieldCheck,
  ScrollText,
  KeyRound,
  Plug,
  KeySquare,
  BookOpen,
  DatabaseBackup,
  Mail,
  Activity,
  FolderKanban,
  UsersRound,
  Fingerprint,
} from 'lucide-react';
import type { Action, Resource } from '@ad-wiki/shared-types';
import { useAuth } from '@/lib/auth-context';

type SettingsNavItem = {
  href: string;
  labelKey: string;
  icon: typeof Users;
  exact?: boolean;
  resource?: Resource;
  anyResources?: Resource[];
  anyPermissions?: Array<{ resource: Resource; action: Action }>;
  authenticated?: boolean;
};

type SettingsNavSection = {
  labelKey: string;
  items: SettingsNavItem[];
};

const NAV_SECTIONS: SettingsNavSection[] = [
  {
    labelKey: 'navSectionBasics',
    items: [
      { href: '/settings', labelKey: 'navGeneral', icon: SlidersHorizontal, exact: true, resource: 'settings' },
    ],
  },
  {
    labelKey: 'navSectionContent',
    items: [
      { href: '/settings/categories', labelKey: 'navCategories', icon: FolderTree, resource: 'categories' },
      { href: '/settings/folders', labelKey: 'navFolders', icon: Folder, resource: 'pages' },
    ],
  },
  {
    labelKey: 'navSectionAccess',
    items: [
      { href: '/settings/users', labelKey: 'navUsers', icon: Users, resource: 'users' },
      { href: '/settings/roles', labelKey: 'navRoles', icon: ShieldCheck, resource: 'roles' },
      { href: '/settings/groups', labelKey: 'navGroups', icon: UsersRound, authenticated: true },
      { href: '/settings/spaces', labelKey: 'navSpaces', icon: FolderKanban, resource: 'spaces' },
      { href: '/settings/api-keys', labelKey: 'navApiKeys', icon: KeySquare, resource: 'api_keys' },
      {
        href: '/settings/identity-providers',
        labelKey: 'navIdentityProviders',
        icon: Fingerprint,
        resource: 'identity_providers',
      },
    ],
  },
  {
    labelKey: 'navSectionServices',
    items: [
      { href: '/settings/smtp', labelKey: 'navSmtp', icon: Mail, resource: 'smtp' },
      { href: '/settings/integrations', labelKey: 'navIntegrations', icon: Plug, resource: 'integrations' },
      { href: '/settings/mcp', labelKey: 'navMcp', icon: KeyRound, resource: 'mcp' },
    ],
  },
  {
    labelKey: 'navSectionOperations',
    items: [
      { href: '/settings/backups', labelKey: 'navBackups', icon: DatabaseBackup, resource: 'backups' },
      { href: '/settings/system-info', labelKey: 'navSystemInfo', icon: Activity, resource: 'system_info' },
      { href: '/settings/audit-logs', labelKey: 'navAudit', icon: ScrollText, resource: 'audit_logs' },
      {
        href: '/settings/setup',
        labelKey: 'navSetup',
        icon: BookOpen,
        anyResources: ['mcp', 'integrations', 'backups', 'settings', 'system_info', 'roles', 'groups', 'spaces', 'resource_acls'],
        anyPermissions: [{ resource: 'groups', action: 'manage_members' }],
      },
    ],
  },
];

/**
 * Layout des Admin-Bereichs mit linker Sub-Navigation. Nur für Admins –
 * andere Nutzer werden auf das Dashboard umgeleitet. Der Route-Schutz ist
 * clientseitig (wie beim übrigen Auth-Handling, Tokens liegen im localStorage).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { hasPermission } = useAuth();
  const pathname = usePathname();
  const t = useTranslations('settings');

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Sub-Navigation */}
        <nav aria-label={t('navLabel')} className="flex shrink-0 gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:gap-0 lg:overflow-visible">
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter((item) => {
              if (item.authenticated) return true;
              if (item.resource) return hasPermission(item.resource, 'read');
              if (item.anyResources?.some((resource) => hasPermission(resource, 'read'))) return true;
              if (item.anyPermissions?.some(({ resource, action }) => hasPermission(resource, action))) return true;
              return false;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.labelKey} className="contents lg:mb-5 lg:block lg:last:mb-0">
                <p className="mb-1 hidden px-3 text-[11px] font-semibold uppercase tracking-wider text-muted lg:block">
                  {t(section.labelKey)}
                </p>
                <div className="contents lg:flex lg:flex-col lg:gap-1">
                  {visibleItems.map((item) => {
                    const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 ${
                          active
                            ? 'bg-accent-50 text-accent-700'
                            : 'text-muted hover:bg-background hover:text-foreground'
                        }`}
                      >
                        <item.icon className="h-4 w-4" aria-hidden="true" />
                        {t(item.labelKey)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Inhalt */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
