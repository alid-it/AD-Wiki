import type { ExportFormat } from '@ad-wiki/shared-types';
import { requestDownload, type DownloadProgress, type DownloadResult } from '../http';

export type { DownloadProgress, DownloadResult };

export function page(id: string, format: 'pdf' | 'markdown', onProgress?: (value: DownloadProgress) => void) {
  return requestDownload(`/pages/${id}/export/${format}`, { auth: true }, onProgress);
}

export function category(id: string, format: 'pdf' | 'markdown', onProgress?: (value: DownloadProgress) => void) {
  return requestDownload(`/categories/${id}/export/${format}`, { auth: true }, onProgress);
}

export function wiki(format: ExportFormat, onProgress?: (value: DownloadProgress) => void) {
  return requestDownload('/export/wiki', { auth: true, query: { format } }, onProgress);
}
