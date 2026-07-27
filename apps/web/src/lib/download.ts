import type { DownloadResult } from '@ad-wiki/api-client';

/** Startet einen Browserdownload und gibt die temporäre Object-URL wieder frei. */
export function saveDownload(result: DownloadResult) {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
