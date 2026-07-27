'use client';

import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { media } from '@ad-wiki/api-client';

interface AuthenticatedMediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  mediaId: string;
}

/** Laedt einen Media-Stream mit Bearer-Token und zeigt ihn als kurzlebige Blob-URL. */
export function AuthenticatedMediaImage({ mediaId, alt, className, ...props }: AuthenticatedMediaImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    media.file(mediaId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(result.blob);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [mediaId]);

  if (failed) {
    return <span role="img" aria-label={alt ?? ''} className={`flex items-center justify-center bg-background text-muted ${className ?? ''}`}><ImageOff className="h-5 w-5" /></span>;
  }
  if (!objectUrl) {
    return <span aria-label={alt ?? ''} className={`flex items-center justify-center bg-background text-muted ${className ?? ''}`}><Loader2 className="h-5 w-5 animate-spin" /></span>;
  }
  // eslint-disable-next-line @next/next/no-img-element -- authentifizierte Blob-URL
  return <img {...props} src={objectUrl} alt={alt ?? ''} className={className} />;
}
