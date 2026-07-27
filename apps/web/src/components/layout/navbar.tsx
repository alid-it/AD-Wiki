'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Menu,
  X,
  Search,
  PanelLeft,
  LayoutDashboard,
  BookOpen,
  Image as ImageIcon,
  User,
  LogOut,
  LogIn,
  Settings as SettingsIcon,
  NotebookPen,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useSidebar } from '@/lib/sidebar-context';
import { useSiteName } from '@/lib/site-name-context';
import { NotificationBell } from '@/components/layout/notification-bell';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { CommandPalette } from '@/components/search/command-palette';
import type { AuthUser } from '@ad-wiki/shared-types';

interface NavItem {
  /** Übersetzungsschlüssel im `nav`-Namespace. */
  key: 'dashboard' | 'wiki' | 'notes' | 'standards' | 'media';
  href: string;
  icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
  { key: 'dashboard', href: '/', icon: LayoutDashboard },
  { key: 'wiki', href: '/wiki', icon: BookOpen },
  { key: 'notes', href: '/notes', icon: NotebookPen },
  { key: 'standards', href: '/standards', icon: ShieldCheck },
  { key: 'media', href: '/media', icon: ImageIcon },
];

/** Bildet aus dem Anzeigenamen (oder der E-Mail) bis zu zwei Initialen. */
function initialsOf(user: AuthUser): string {
  const source = user.displayName.trim() || user.email;
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

export function Navbar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { user, logout, hasPermission } = useAuth();
  const { toggle: toggleSidebar } = useSidebar();
  const { siteName } = useSiteName();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', openSearch);
    return () => document.removeEventListener('keydown', openSearch);
  }, []);

  // Sidebar-Toggle nur dort zeigen, wo es eine Sidebar gibt.
  const onWiki = pathname.startsWith('/wiki');

  const isActiveHref = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);
  const visibleNavItems = navItems.filter((item) => {
    if (item.key === 'wiki') return hasPermission('pages', 'read');
    if (item.key === 'media') return hasPermission('media', 'read');
    if (item.key === 'notes') return hasPermission('notes', 'read');
    if (item.key === 'standards') return hasPermission('standards', 'read');
    return true;
  });
  const canSearch = (['pages', 'notes', 'standards', 'media'] as const).some((resource) =>
    hasPermission(resource, 'read'),
  );
  const settingsDestination = [
    ['settings', '/settings'],
    ['categories', '/settings/categories'],
    ['pages', '/settings/folders'],
    ['users', '/settings/users'],
    ['roles', '/settings/roles'],
    ['api_keys', '/settings/api-keys'],
    ['smtp', '/settings/smtp'],
    ['integrations', '/settings/integrations'],
    ['mcp', '/settings/mcp'],
    ['backups', '/settings/backups'],
    ['system_info', '/settings/system-info'],
    ['audit_logs', '/settings/audit-logs'],
  ] as const;
  const firstReadableSetting = settingsDestination.find(([resource]) =>
    hasPermission(resource, 'read'),
  );

  return (
    <>
    <header className="app-navbar sticky top-0 z-40 bg-brand-600 shadow-soft-md dark:bg-brand-800">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
        {/* Linke Seite: Sidebar-Toggle + Mobile-Nav + Logo + Desktop-Nav */}
        <div className="flex items-center gap-1 sm:gap-4">
          {/* Fester Slot verhindert, dass Logo und Navigation je nach Route springen. */}
          <div className="h-11 w-11 shrink-0">
            {onWiki && (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t('toggleSidebar')}
                title={t('toggleSidebar')}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
              >
                <PanelLeft className="h-5 w-5" />
              </button>
            )}
          </div>

          {canSearch && <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? t('closeMenu') : t('openMenu')}
            aria-expanded={mobileOpen}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:hidden cursor-pointer"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>}

          <Link
            href="/"
            title={siteName}
            className="max-w-28 truncate text-lg font-semibold text-white transition-opacity hover:opacity-90 sm:max-w-44"
          >
            {siteName}
          </Link>

          <div className="hidden h-5 w-px bg-white/30 sm:block" />

          <nav className="hidden items-center gap-1 sm:flex">
            {visibleNavItems.map((item) => {
              const active = isActiveHref(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Rechte Seite: Suche + Sprache/Theme + Auth */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Mobile: Icon-only, expandiert bei Klick zum Suchfeld */}
          {canSearch && <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t('openSearch')}
            aria-expanded={searchOpen}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:hidden cursor-pointer"
          >
            <Search className="h-5 w-5" />
          </button>}

          {/* Desktop: Eingabefeld → /search?q= bei Enter */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t('searchAria')}
            className="hidden min-h-9 min-w-[230px] items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-3 text-sm text-white/70 transition-colors hover:border-white/40 hover:bg-white/15 hover:text-white md:flex"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">{t('searchPlaceholder')}</span>
            <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70">Ctrl K</kbd>
          </button>

          {/* Kompakter Sprach- und Theme-Umschalter (klein und dezent). */}
          <LanguageSwitcher />
          <ThemeToggle />

          {/* Admin: Zahnrad → Einstellungen */}
          {firstReadableSetting && (
            <Link
              href={firstReadableSetting[1]}
              aria-label={t('settings')}
              title={t('settings')}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer ${
                pathname.startsWith('/settings') ? 'bg-white/20' : ''
              }`}
            >
              <SettingsIcon className="h-5 w-5" />
            </Link>
          )}

          {user && <NotificationBell />}

          {user ? (
            <UserMenu user={user} onLogout={logout} />
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-600 transition-colors hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
            >
              <LogIn className="h-4 w-4" />
              {t('login')}
            </Link>
          )}
        </div>
      </div>

      {/* Mobile: ausgeklapptes Suchfeld */}
      {/* Mobile-Navigation: klappbares Panel */}
      {mobileOpen && (
        <nav className="border-t border-white/10 bg-brand-600 px-4 pb-3 pt-2 dark:bg-brand-800 sm:hidden">
          {visibleNavItems.map((item) => {
            const active = isActiveHref(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {t(item.key)}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
    <CommandPalette open={canSearch && searchOpen} onClose={closeSearch} />
    </>
  );
}

interface UserMenuProps {
  user: AuthUser;
  onLogout: () => void | Promise<void>;
}

/** Avatar mit Initialen und aufklappbarem Menü (Profil, Abmelden). */
function UserMenu({ user, onLogout }: UserMenuProps) {
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Klick außerhalb und Escape schließen das Menü.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('userMenu')}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white transition-colors hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
      >
        {initialsOf(user)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-soft-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-foreground">{user.displayName}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>

          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-background cursor-pointer"
          >
            <User className="h-4 w-4 text-muted" />
            {t('profile')}
          </Link>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void onLogout();
            }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-danger-600 transition-colors hover:bg-danger-50 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            {t('logout')}
          </button>
        </div>
      )}
    </div>
  );
}
