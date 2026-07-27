'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { BookOpen, FileText, Hash, Image as ImageIcon, NotebookPen, ShieldCheck } from 'lucide-react';
import type { GlobalSearchResult, GlobalSearchResultType } from '@ad-wiki/shared-types';

const TYPE_CONFIG = {
  page: { icon: BookOpen, label: 'typePage', tone: 'bg-accent-50 text-accent-700 dark:bg-accent-950/40 dark:text-accent-300' },
  note: { icon: NotebookPen, label: 'typeNote', tone: 'bg-warning-50 text-warning-700 dark:bg-warning-950/40 dark:text-warning-300' },
  standard: { icon: ShieldCheck, label: 'typeStandard', tone: 'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-300' },
  media: { icon: ImageIcon, label: 'typeMedia', tone: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300' },
  tag: { icon: Hash, label: 'typeTag', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
} as const satisfies Record<GlobalSearchResultType, { icon: typeof FileText; label: string; tone: string }>;

const MATCH_LABELS: Record<GlobalSearchResult['matchField'], string> = {
  title: 'matchTitle',
  content: 'matchContent',
  description: 'matchDescription',
  filename: 'matchFilename',
  altText: 'matchAltText',
  tag: 'matchTag',
};

export function SearchResultIcon({ type, className = 'h-4 w-4' }: { type: GlobalSearchResultType; className?: string }) {
  const Icon = TYPE_CONFIG[type].icon;
  return <Icon className={className} />;
}

export function SearchResultItem({ result, compact = false, active = false, onOpen }: {
  result: GlobalSearchResult;
  compact?: boolean;
  active?: boolean;
  onOpen?: () => void;
}) {
  const t = useTranslations('search');
  const locale = useLocale();
  const config = TYPE_CONFIG[result.type];

  return (
    <Link
      href={result.url}
      onClick={onOpen}
      className={`group flex gap-3 rounded-xl transition-colors ${compact ? 'px-3 py-2.5' : 'border border-border bg-surface p-4'} ${active ? 'bg-accent-50 ring-1 ring-accent-300 dark:bg-accent-950/30' : compact ? 'hover:bg-background' : 'hover:border-accent-300 hover:bg-background'}`}
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${config.tone}`}>
        <SearchResultIcon type={result.type} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="truncate text-sm font-semibold text-foreground group-hover:text-accent-700 dark:group-hover:text-accent-300">
            {result.title}
          </span>
          {!compact && (
            <time className="shrink-0 text-xs text-muted" dateTime={result.updatedAt}>
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(result.updatedAt))}
            </time>
          )}
        </span>
        {result.excerpt && (
          <span className={`mt-1 block text-sm text-muted ${compact ? 'truncate' : 'line-clamp-2'}`}>
            {result.excerpt}
          </span>
        )}
        {!compact && (
          <span className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            <span className={`rounded-full px-2 py-0.5 font-medium ${config.tone}`}>{t(config.label)}</span>
            <span>{t(MATCH_LABELS[result.matchField])}</span>
          </span>
        )}
      </span>
    </Link>
  );
}
