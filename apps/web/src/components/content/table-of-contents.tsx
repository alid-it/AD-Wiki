import { ListTree } from 'lucide-react';
import type { ArticleHeading } from '@/lib/article-headings';

interface TableOfContentsProps {
  headings: ArticleHeading[];
  title: string;
  collapsible?: boolean;
}

const INDENT = ['pl-0', 'pl-3', 'pl-6', 'pl-9'];

/** Verlinkt die automatisch erzeugten Überschriftenanker eines Artikels. */
export function TableOfContents({ headings, title, collapsible = false }: TableOfContentsProps) {
  const minimumLevel = Math.min(...headings.map((heading) => heading.level));
  const links = (
    <ol className="mt-3 flex flex-col gap-1 border-l border-border pl-3">
      {headings.map((heading) => {
        const indent = Math.min(Math.max(heading.level - minimumLevel, 0), INDENT.length - 1);
        return (
          <li key={heading.id} className={INDENT[indent]}>
            <a href={`#${heading.id}`} className="block rounded-md px-2 py-1.5 text-xs leading-5 text-muted transition-colors hover:bg-accent-50 hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600">
              {heading.text}
            </a>
          </li>
        );
      })}
    </ol>
  );

  if (collapsible) {
    return (
      <details className="article-toc rounded-xl border border-border bg-surface p-4">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground">
          <ListTree className="h-4 w-4 text-accent-600" />
          {title}
        </summary>
        {links}
      </details>
    );
  }

  return (
    <nav aria-label={title} className="article-toc rounded-xl border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <ListTree className="h-3.5 w-3.5" />
        {title}
      </h2>
      {links}
    </nav>
  );
}
