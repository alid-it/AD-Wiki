import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export const knowledgeHeaderPrimaryAction =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export const knowledgeHeaderSecondaryAction =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground transition-colors duration-200 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export const knowledgeHeaderIconAction =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors duration-200 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

interface KnowledgePageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  iconClassName?: string;
}

/** Gemeinsamer Kopfbereich aller Wissensarten und des Dashboards. */
export function KnowledgePageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  iconClassName = 'bg-brand-50 text-brand-600',
}: KnowledgePageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
