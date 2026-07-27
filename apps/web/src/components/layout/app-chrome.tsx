'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Navbar } from '@/components/layout/navbar';
import { useAuth } from '@/lib/auth-context';
import { SidebarProvider } from '@/lib/sidebar-context';
import { PermissionLiveSync } from '@/components/layout/permission-live-sync';
import { AccessDenied } from '@/components/auth/access-denied';
import { getRouteAccessPolicy, mayAccessRoute } from '@/lib/route-permissions';

/** Routen, die nur für NICHT eingeloggte Nutzer gedacht sind. */
const AUTH_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password'];
const GUEST_ONLY_ROUTES = ['/login', '/register'];

/** Ganzseitiger Ladezustand, während der Auth-Status aufgelöst wird. */
function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" aria-label="Wird geladen" />
    </div>
  );
}

/**
 * Rahmen der App: entscheidet anhand des Auth-Status, ob die Navbar gezeigt wird
 * und ob ein Redirect nötig ist.
 *
 * Route-Schutz ist bewusst clientseitig, da die Tokens im localStorage liegen
 * und für Next-Middleware (Server/Edge) nicht lesbar sind.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const isGuestOnlyRoute = GUEST_ONLY_ROUTES.includes(pathname);
  const isPublicRoute = pathname.startsWith('/public/');
  const routePolicy = getRouteAccessPolicy(pathname);
  const canAccessRoute = mayAccessRoute(routePolicy, hasPermission);

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated && !isAuthRoute && !isPublicRoute) {
      router.replace('/login');
    } else if (isAuthenticated && isGuestOnlyRoute) {
      router.replace('/');
    }
  }, [isLoading, isAuthenticated, isAuthRoute, isGuestOnlyRoute, isPublicRoute, router]);

  // Während der Auflösung – oder wenn gerade umgeleitet wird – nur den Loader
  // zeigen, damit geschützte Inhalte nie kurz aufblitzen.
  if (isLoading) return <FullScreenLoader />;
  if (!isAuthenticated && !isAuthRoute && !isPublicRoute) return <FullScreenLoader />;
  if (isAuthenticated && isGuestOnlyRoute) return <FullScreenLoader />;

  // Auth-Seiten (Login/Register) bekommen ein eigenes Layout ohne Navbar.
  if (isAuthRoute || isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <PermissionLiveSync />
      <Navbar />
      <main>{routePolicy && !canAccessRoute ? <AccessDenied policy={routePolicy} /> : children}</main>
    </SidebarProvider>
  );
}
