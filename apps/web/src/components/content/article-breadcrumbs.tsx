import Link from 'next/link';
import { Fragment } from 'react';
import { ChevronRight, Home } from 'lucide-react';
import type { PageDetail } from '@ad-wiki/shared-types';

interface ArticleBreadcrumbsProps {
  page: PageDetail;
  wikiLabel: string;
}

/** Zeigt Kategorie und Elternkette der aktuellen Wiki-Seite. */
export function ArticleBreadcrumbs({ page, wikiLabel }: ArticleBreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="article-breadcrumbs mb-4 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 text-xs text-muted">
        <li>
          <Link href="/wiki" className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-accent-50 hover:text-accent-700">
            <Home className="h-3.5 w-3.5" />
            {wikiLabel}
          </Link>
        </li>
        {page.category && <BreadcrumbSeparator />}
        {page.category && (
          <li>
            <Link href={`/wiki?category=${page.category.slug}`} className="inline-flex min-h-8 items-center rounded-md px-1.5 transition-colors hover:bg-accent-50 hover:text-accent-700">
              {page.category.name}
            </Link>
          </li>
        )}
        {page.ancestors.map((ancestor) => (
          <Fragment key={ancestor.id}>
            <BreadcrumbSeparator />
            <li>{ancestor.type === 'page' ? (
              <Link href={`/wiki/${ancestor.slug}`} className="inline-flex min-h-8 items-center rounded-md px-1.5 transition-colors hover:bg-accent-50 hover:text-accent-700">
                {ancestor.title}
              </Link>
            ) : (
              <span className="inline-flex min-h-8 items-center px-1.5">{ancestor.title}</span>
            )}</li>
          </Fragment>
        ))}
        <BreadcrumbSeparator />
        <li aria-current="page" className="max-w-64 truncate px-1.5 font-medium text-foreground">{page.title}</li>
      </ol>
    </nav>
  );
}

function BreadcrumbSeparator() {
  return <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>;
}
