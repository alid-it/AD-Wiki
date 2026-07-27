'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { MarkdownView } from '@/components/content/markdown-view';

/**
 * Lädt eine Markdown-Datei von ihrer URL und rendert sie als HTML-Vorschau.
 * Genutzt in den Medien-Vorschau-Modals, damit `.md`-Dateien lesbar statt roh
 * angezeigt werden.
 */
export function MarkdownFilePreview({ src }: { src: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setError(false);
    fetch(src, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('load failed');
        return res.text();
      })
      .then(setContent)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(true);
      });
    return () => controller.abort();
  }, [src]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted">
        <AlertCircle className="h-6 w-6" />
        Die Markdown-Datei konnte nicht geladen werden.
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto rounded-lg border border-border bg-surface p-5 sm:p-8">
      <MarkdownView content={content} />
    </div>
  );
}
