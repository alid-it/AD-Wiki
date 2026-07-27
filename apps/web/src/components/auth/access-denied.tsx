'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LayoutDashboard, ShieldX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RouteAccessPolicy } from '@/lib/route-permissions';

export function AccessDenied({ policy }: { policy: RouteAccessPolicy }) {
  const router = useRouter();
  const t = useTranslations('accessDenied');
  const permissionList = policy.permissions
    .map(({ resource, action }) => `${resource}:${action}`)
    .join(policy.mode === 'any' ? ` ${t('or')} ` : ', ');

  return (
    <section
      aria-labelledby="access-denied-title"
      className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-2xl items-center justify-center p-4 sm:p-6"
    >
      <div className="w-full rounded-2xl border border-border bg-surface p-6 text-center sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-50 text-danger-600">
          <ShieldX className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 id="access-denied-title" className="mt-5 text-2xl font-semibold text-foreground">
          {t('title')}
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
          {t('description')}
        </p>
        <p className="mx-auto mt-4 max-w-full overflow-x-auto rounded-lg bg-background px-3 py-2 font-mono text-xs text-foreground">
          {permissionList}
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('back')}
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            {t('dashboard')}
          </Link>
        </div>
      </div>
    </section>
  );
}
