'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { Media } from '@ad-wiki/shared-types';
import { isImageMime, isMarkdownFile } from '@/lib/content';
import { MarkdownFilePreview } from '@/components/content/markdown-file-preview';
import { AuthenticatedMediaImage } from '@/components/content/authenticated-media-image';
import { media as mediaApi } from '@ad-wiki/api-client';

/**
 * Vollbild-Vorschau (Lightbox/Modal) für ein Medium:
 * - Bilder (inkl. SVG) → skaliert dargestellt
 * - Markdown → gerendert als HTML
 * - PDF und Sonstiges → eingebettet via `<iframe>`
 */
export function MediaPreviewModal({
  media,
  onClose,
}: {
  media: Media;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isImageMime(media.mimetype)) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    mediaApi.file(media.id, controller.signal).then((result) => {
      objectUrl = URL.createObjectURL(result.blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.id, media.mimetype]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Vorschau schließen"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-pointer"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Vorschau von ${media.filename}`}
        className="relative flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg"
      >
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4">
          <p className="truncate text-sm font-semibold text-foreground">{media.filename}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Vorschau schließen"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-background hover:text-foreground cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-3 sm:p-5">
          {isImageMime(media.mimetype) ? (
            <AuthenticatedMediaImage
              mediaId={media.id}
              alt={media.altText ?? media.filename}
              className="max-h-[calc(90dvh-6rem)] max-w-full object-contain"
            />
          ) : !url ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          ) : isMarkdownFile(media.mimetype, media.filename) ? (
            <div className="h-[calc(90dvh-6rem)] min-h-96 w-full">
              <MarkdownFilePreview src={url} />
            </div>
          ) : (
            <iframe
              src={url}
              title={`Vorschau: ${media.filename}`}
              className="h-[calc(90dvh-6rem)] min-h-96 w-full rounded-lg border border-border bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
