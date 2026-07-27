import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Zeile unter der Card, z. B. Link zur jeweils anderen Auth-Seite. */
  footer: ReactNode;
}

/**
 * Ganzseitiges, zentriertes Layout für Login/Register – ohne Navbar.
 * Ruhig und fokussiert gemäß Design-System (Flat Design, weiche Schatten).
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        {/* Marke */}
        <Link
          href="/login"
          className="mb-6 flex items-center justify-center gap-2 text-brand-600 transition-opacity hover:opacity-90"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BookOpen className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold text-foreground">AD-Wiki</span>
        </Link>

        {/* Card */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-soft-lg sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          </div>
          {children}
        </div>

        <p className="mt-6 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}
