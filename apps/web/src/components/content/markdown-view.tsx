'use client';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { wikiLinkMarkdown } from '@/lib/wiki-links';
import { mediaIdFromUrl } from '@/lib/content';
import { AuthenticatedMediaImage } from '@/components/content/authenticated-media-image';
import { extractArticleHeadings } from '@/lib/article-headings';

interface MarkdownViewProps {
  content: string;
  onCheckboxChange?: (checkboxIndex: number, checked: boolean) => Promise<void>;
}

interface MarkdownNode {
  type: string;
  checked?: boolean;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
}

/** Gibt jedem echten GFM-Task-Item einen stabilen Index; Code-Beispiele bleiben unberührt. */
function remarkCheckboxIndexes() {
  return (tree: MarkdownNode) => {
    let checkboxIndex = 0;
    const visit = (node: MarkdownNode) => {
      if (node.type === 'listItem' && typeof node.checked === 'boolean') {
        node.data ??= {};
        node.data.hProperties ??= {};
        node.data.hProperties['data-checkbox-index'] = checkboxIndex;
        checkboxIndex += 1;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * Rendert Markdown (inkl. GitHub-Flavored-Markdown: Tabellen, Todo-Listen,
 * Durchstreichen) als HTML. Styling kommt aus der `.prose-content`-Klasse.
 * react-markdown lässt rohes HTML standardmäßig weg → sicher gegen XSS.
 */
export function MarkdownView({ content, onCheckboxChange }: MarkdownViewProps) {
  const headings = extractArticleHeadings(content);
  let headingIndex = 0;
  const headingId = () => headings[headingIndex++]?.id;

  return (
    <div className="prose-content">
      <Markdown
        remarkPlugins={[remarkGfm, remarkCheckboxIndexes]}
        components={{
          h1: ({ node: _node, ...props }) => <h1 {...props} id={headingId()} />,
          h2: ({ node: _node, ...props }) => <h2 {...props} id={headingId()} />,
          h3: ({ node: _node, ...props }) => <h3 {...props} id={headingId()} />,
          h4: ({ node: _node, ...props }) => <h4 {...props} id={headingId()} />,
          img: ({ src, alt, ...props }) => {
            const mediaId = typeof src === 'string' ? mediaIdFromUrl(src) : null;
            return mediaId
              ? <AuthenticatedMediaImage {...props} mediaId={mediaId} alt={alt ?? ''} />
              // eslint-disable-next-line @next/next/no-img-element -- externe Markdown-Bildquelle
              : <img {...props} src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} />;
          },
          input: ({ node: _node, ...props }) => (
            <input
              {...props}
              disabled={props.type === 'checkbox' ? !onCheckboxChange : props.disabled}
              onChange={props.type === 'checkbox' ? () => undefined : props.onChange}
            />
          ),
          li: ({ node, ...props }) => {
            const properties = node?.properties as Record<string, unknown> | undefined;
            const rawIndex = properties?.dataCheckboxIndex ?? properties?.['data-checkbox-index'];
            const checkboxIndex = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
            return (
              <li
                {...props}
                onChange={async (event) => {
                  const target = event.target;
                  if (!onCheckboxChange || !Number.isInteger(checkboxIndex) || !(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
                  const checked = target.checked;
                  target.disabled = true;
                  try {
                    await onCheckboxChange(checkboxIndex, checked);
                  } catch {
                    target.checked = !checked;
                  } finally {
                    target.disabled = false;
                  }
                }}
              />
            );
          },
        }}
      >
        {wikiLinkMarkdown(content)}
      </Markdown>
    </div>
  );
}
