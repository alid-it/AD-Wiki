/**
 * Abstraktion über die Token-Ablage. Standardmäßig wird der Browser-
 * `localStorage` genutzt (Web). Für die spätere React-Native-App lässt sich
 * über {@link setTokenStore} eine eigene Implementierung (z. B. SecureStore)
 * einhängen, ohne den restlichen Client anzupassen.
 */
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  setTokens(tokens: { accessToken: string; refreshToken?: string }): void;
  clear(): void;
}

const ACCESS_KEY = 'ad-wiki.accessToken';
const REFRESH_KEY = 'ad-wiki.refreshToken';

/** True, wenn ein Browser-`localStorage` verfügbar ist (nicht bei SSR/RN). */
const hasLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

/**
 * Default-Store auf Basis von `localStorage`. Serverseitig (Server Components)
 * liefert er `null` und ignoriert Schreibzugriffe – dort werden ohnehin nur
 * öffentliche Endpunkte ohne Token aufgerufen.
 */
const localStorageTokenStore: TokenStore = {
  getAccessToken: () => (hasLocalStorage() ? window.localStorage.getItem(ACCESS_KEY) : null),
  getRefreshToken: () => (hasLocalStorage() ? window.localStorage.getItem(REFRESH_KEY) : null),
  setTokens: ({ accessToken, refreshToken }) => {
    if (!hasLocalStorage()) return;
    window.localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken !== undefined) {
      window.localStorage.setItem(REFRESH_KEY, refreshToken);
    }
  },
  clear: () => {
    if (!hasLocalStorage()) return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

let activeStore: TokenStore = localStorageTokenStore;

/** Aktiven Token-Store austauschen (z. B. für React Native oder Tests). */
export function setTokenStore(store: TokenStore): void {
  activeStore = store;
}

/** Aktiven Token-Store lesen. */
export function getTokenStore(): TokenStore {
  return activeStore;
}
