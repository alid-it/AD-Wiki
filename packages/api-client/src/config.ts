/**
 * Konfiguration des API-Clients. Die Basis-URL kommt aus der Umgebung
 * (`NEXT_PUBLIC_API_URL`) und funktioniert sowohl serverseitig (Server
 * Components) als auch im Browser, da eine absolute URL verwendet wird.
 */

/** Standard-Basis-URL für die lokale Entwicklung. */
const DEFAULT_BASE_URL = 'http://localhost:4000/api/v1';

interface ApiClientConfig {
  baseUrl: string;
}

const config: ApiClientConfig = {
  baseUrl: normalizeBaseUrl(
    // process.env ist in Next.js zur Build-Zeit ersetzt; optional-guard für RN.
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
      DEFAULT_BASE_URL,
  ),
};

/** Entfernt einen abschließenden Schrägstrich, damit Pfade sauber angehängt werden. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Überschreibt die Basis-URL zur Laufzeit – nützlich für Tests oder eine
 * spätere React-Native-App mit abweichendem Backend-Host.
 */
export function configureApiClient(next: Partial<ApiClientConfig>): void {
  if (next.baseUrl !== undefined) {
    config.baseUrl = normalizeBaseUrl(next.baseUrl);
  }
}

/** Aktuelle Client-Konfiguration lesen. */
export function getConfig(): Readonly<ApiClientConfig> {
  return config;
}
