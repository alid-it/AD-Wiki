import type { z, ZodTypeAny } from 'zod';
import { ApiErrorSchema, PaginationMetaSchema } from '@ad-wiki/shared-types';
import { getConfig } from './config';
import { getTokenStore } from './token-store';
import { ApiClientError } from './errors';

/** Optionen für einen einzelnen HTTP-Aufruf. */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-Body; wird automatisch serialisiert (außer bei `formData`). */
  body?: unknown;
  /** Query-Parameter; `undefined`-Werte werden weggelassen. */
  query?: Record<string, string | number | undefined>;
  /** Wenn true, wird der Access-Token als Bearer mitgeschickt (mit Auto-Refresh). */
  auth?: boolean;
  /** Roher FormData-Body für Datei-Uploads (setzt keinen content-type). */
  formData?: FormData;
  signal?: AbortSignal;
}

export interface DownloadProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

export interface DownloadResult {
  blob: Blob;
  filename: string;
  contentType: string;
}

/** Interne Repräsentation einer erfolgreichen Envelope-Antwort. */
interface Envelope {
  data: unknown;
  meta?: unknown;
}

// ── Token-Refresh: gleichzeitige 401-Fehler teilen sich einen Refresh-Versuch ──
let refreshPromise: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<boolean> {
  const store = getTokenStore();
  const refreshToken = store.getRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${getConfig().baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      store.clear();
      return false;
    }
    const json = (await res.json()) as {
      data?: { accessToken?: unknown; refreshToken?: unknown };
    };
    const accessToken = json?.data?.accessToken;
    const rotatedRefreshToken = json?.data?.refreshToken;
    if (typeof accessToken !== 'string' || typeof rotatedRefreshToken !== 'string') {
      store.clear();
      return false;
    }
    store.setTokens({ accessToken, refreshToken: rotatedRefreshToken });
    return true;
  } catch {
    // Netzwerkfehler beim Refresh: Tokens vorsichtshalber verwerfen.
    store.clear();
    return false;
  }
}

/** Baut die vollständige URL inklusive Query-String. */
function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${getConfig().baseUrl}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Führt einen Fetch aus und übersetzt Fehler in {@link ApiClientError}. */
async function fetchOnce(url: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (!opts.formData) {
    headers['content-type'] = 'application/json';
  }
  if (opts.auth) {
    const token = getTokenStore().getAccessToken();
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
    }
  }

  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new ApiClientError('NETWORK', 'Verbindung zum Server fehlgeschlagen.', 0);
  }
}

/**
 * Extrahiert eine benutzerfreundliche Fehlermeldung aus einem Fehler-Body.
 * Akzeptiert ausschließlich das kontrollierte Projekt-Envelope. Rohe
 * Framework- oder Proxy-Meldungen werden bewusst durch einen sicheren Text
 * ersetzt und gelangen nie in die Oberfläche.
 */
function extractError(status: number, body: unknown): ApiClientError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    return new ApiClientError(
      parsed.data.error.code,
      parsed.data.error.message,
      status,
      parsed.data.error.fieldErrors,
    );
  }
  return new ApiClientError(`HTTP_${status}`, fallbackErrorMessage(status), status);
}

function fallbackErrorMessage(status: number): string {
  if (status === 400) return 'Bitte prüfe deine Angaben und versuche es erneut.';
  if (status === 401) return 'Bitte melde dich an oder prüfe deine Zugangsdaten.';
  if (status === 403) return 'Du hast keine Berechtigung für diese Aktion.';
  if (status === 404) return 'Der angeforderte Inhalt wurde nicht gefunden.';
  if (status === 409) return 'Die Änderung konnte wegen eines Konflikts nicht gespeichert werden.';
  if (status === 413) return 'Die übermittelte Datei oder Anfrage ist zu groß.';
  if (status === 429) return 'Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.';
  if (status >= 500) return 'Die Anfrage konnte gerade nicht verarbeitet werden. Bitte versuche es später erneut.';
  return 'Die Anfrage konnte nicht verarbeitet werden.';
}

/**
 * Kern-Request: fetch → optionaler Token-Refresh bei 401 → Envelope auspacken.
 * Wirft {@link ApiClientError} bei HTTP- oder Envelope-Fehlern.
 */
async function rawRequest(path: string, opts: RequestOptions): Promise<Envelope> {
  const url = buildUrl(path, opts.query);
  let res = await fetchOnce(url, opts);

  // Bei 401 auf geschützten Routen genau einmal einen Refresh versuchen.
  if (res.status === 401 && opts.auth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetchOnce(url, opts);
    }
  }

  if (res.status === 204) {
    return { data: null };
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw extractError(res.status, json);
  }

  const envelope = json as { success?: boolean; data?: unknown; meta?: unknown };
  if (!envelope || envelope.success !== true) {
    throw extractError(res.status, json);
  }

  return { data: envelope.data, meta: envelope.meta };
}

/** Validiert Daten gegen ein Schema und wirft bei Abweichung einen klaren Fehler. */
function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiClientError(
      'INVALID_RESPONSE',
      'Die Antwort des Servers hatte ein unerwartetes Format.',
      500,
    );
  }
  return result.data;
}

/** Einzelressource laden und gegen `schema` validieren. */
export async function requestData<S extends ZodTypeAny>(
  schema: S,
  path: string,
  opts: RequestOptions = {},
): Promise<z.infer<S>> {
  const { data } = await rawRequest(path, opts);
  return parse(schema, data);
}

/** Paginierte Liste laden: `data` gegen `schema`, `meta` gegen `metaSchema`. */
export async function requestList<
  S extends ZodTypeAny,
  M extends ZodTypeAny = typeof PaginationMetaSchema,
>(
  schema: S,
  path: string,
  opts: RequestOptions = {},
  metaSchema: M = PaginationMetaSchema as unknown as M,
): Promise<{ data: z.infer<S>; meta: z.infer<M> }> {
  const { data, meta } = await rawRequest(path, opts);
  return { data: parse(schema, data), meta: parse(metaSchema, meta) };
}

/** Aufruf ohne relevanten Antwort-Body (z. B. DELETE, logout). */
export async function requestVoid(path: string, opts: RequestOptions = {}): Promise<void> {
  await rawRequest(path, opts);
}

/** Binärdownload mit Token-Refresh, Server-Dateiname und optionalem Fortschritt. */
export async function requestDownload(
  path: string,
  opts: RequestOptions = {},
  onProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadResult> {
  const url = buildUrl(path, opts.query);
  let response = await fetchOnce(url, opts);
  if (response.status === 401 && opts.auth && await tryRefresh()) {
    response = await fetchOnce(url, opts);
  }
  if (!response.ok) {
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    throw extractError(response.status, body);
  }

  const totalHeader = Number(response.headers.get('content-length'));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer);
      loaded += value.byteLength;
      onProgress?.({ loaded, total, percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : null });
    }
  } else {
    const buffer = await response.arrayBuffer();
    chunks.push(buffer);
    loaded = buffer.byteLength;
    onProgress?.({ loaded, total, percent: total ? 100 : null });
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const utf8Name = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const fallbackName = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  let filename = 'download';
  try { filename = utf8Name ? decodeURIComponent(utf8Name) : fallbackName ?? filename; } catch { filename = fallbackName ?? filename; }
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  return { blob: new Blob(chunks, { type: contentType }), filename, contentType };
}
