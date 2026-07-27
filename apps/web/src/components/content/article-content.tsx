'use client';

import { useEffect, useRef } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { isHtmlContent } from '@/lib/content';
import { MarkdownView } from '@/components/content/markdown-view';
import { wikiLinkHtml } from '@/lib/wiki-links';
import { media } from '@ad-wiki/api-client';
import { mediaIdFromUrl } from '@/lib/content';
import { addHeadingIdsToHtml, extractArticleHeadings } from '@/lib/article-headings';

/**
 * Rendert Seiteninhalt abhängig vom Format:
 * - HTML (WYSIWYG-Editor) → mit DOMPurify sanitisiert, dann eingebettet.
 * - sonst → als Markdown.
 *
 * Die Sanitisierung ist wichtig: gespeichertes HTML wird sonst als Stored-XSS
 * für alle Leser ausführbar.
 */
interface ArticleContentProps {
  content: string;
  onCheckboxChange?: (checkboxIndex: number, checked: boolean) => Promise<void>;
}

export function ArticleContent({ content, onCheckboxChange }: ArticleContentProps) {
  const htmlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = htmlRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
      const taskItem = input.closest<HTMLElement>('li[data-type="taskItem"]');
      if (taskItem?.dataset.checked === 'true') input.checked = true;
      if (taskItem?.dataset.checked === 'false') input.checked = false;
      input.disabled = !onCheckboxChange;
    });
  }, [content, onCheckboxChange]);

  useEffect(() => {
    const root = htmlRef.current;
    if (!root) return;
    const controllers: AbortController[] = [];
    const objectUrls: string[] = [];
    root.querySelectorAll<HTMLImageElement>('img[data-media-id]').forEach((image) => {
      const mediaId = image.dataset.mediaId;
      if (!mediaId) return;
      const controller = new AbortController();
      controllers.push(controller);
      media.file(mediaId, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(result.blob);
        objectUrls.push(url);
        image.src = url;
      }).catch(() => image.setAttribute('data-media-error', 'true'));
    });
    return () => {
      controllers.forEach((controller) => controller.abort());
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [content]);

  if (isHtmlContent(content)) {
    const linked = wikiLinkHtml(DOMPurify.sanitize(content)).replace(
      /(<img\b[^>]*?)\s+src=(["'])([^"']+)\2/gi,
      (tag, prefix: string, _quote: string, src: string) => {
        const mediaId = mediaIdFromUrl(src);
        return mediaId ? `${prefix} data-media-id="${mediaId}"` : tag;
      },
    );
    const clean = addHeadingIdsToHtml(linked, extractArticleHeadings(linked));
    return (
      <div
        ref={htmlRef}
        className="prose-content"
        onClick={async (event) => {
          const target = event.target;
          if (!onCheckboxChange || !(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
          const item = target.closest('li[data-type="taskItem"]');
          const root = htmlRef.current;
          if (!item || !root) return;
          const checkboxIndex = [...root.querySelectorAll('li[data-type="taskItem"]')].indexOf(item);
          if (checkboxIndex < 0) return;
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
        // eslint-disable-next-line react/no-danger -- Inhalt ist mit DOMPurify sanitisiert.
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return <MarkdownView content={content} onCheckboxChange={onCheckboxChange} />;
}
