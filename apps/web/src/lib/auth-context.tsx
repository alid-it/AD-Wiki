'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { auth, getTokenStore } from '@ad-wiki/api-client';
import type { AclEntry, Action, AuthUser, RegisterInput, Resource } from '@ad-wiki/shared-types';

/** Nach außen sichtbarer Auth-Zustand samt Aktionen. */
interface AuthContextValue {
  user: AuthUser | null;
  /** True, solange der initiale `/auth/me`-Check läuft. */
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  completeOidcLogin: (code: string) => Promise<void>;
  register: (data: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Aktualisiert den lokalen User (z. B. nach einer Profiländerung). */
  updateUser: (user: AuthUser) => void;
  hasPermission: (resource: Resource, action: Action) => boolean;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Stellt den Auth-Zustand für die gesamte App bereit.
 *
 * Beim Start wird geprüft, ob ein Access-Token im localStorage liegt; falls ja,
 * wird `/auth/me` aufgerufen. Ein automatischer Token-Refresh bei 401 ist bereits
 * im api-client gekapselt – schlägt auch der Refresh fehl, gilt der User als
 * abgemeldet und die lokalen Tokens werden verworfen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [permissions, setPermissions] = useState<AclEntry[]>([]);

  // Initialer Session-Check nach dem Mount (nur clientseitig verfügbar).
  useEffect(() => {
    let aborted = false;

    async function bootstrap() {
      if (!auth.isAuthenticated()) {
        setIsLoading(false);
        return;
      }
      try {
        const [me, effectivePermissions] = await Promise.all([
          auth.me(),
          auth.permissions(),
        ]);
        if (!aborted) {
          setUser(me);
          setPermissions(effectivePermissions);
        }
      } catch {
        // Token ungültig/abgelaufen (auch nach Refresh) → lokal verwerfen.
        getTokenStore().clear();
        if (!aborted) { setUser(null); setPermissions([]); }
      } finally {
        if (!aborted) setIsLoading(false);
      }
    }

    void bootstrap();
    return () => {
      aborted = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await auth.login({ email, password });
    setUser(result.user);
    setPermissions(await auth.permissions());
  }, []);

  const completeOidcLogin = useCallback(async (code: string) => {
    const result = await auth.exchangeOidcLoginCode(code);
    setUser(result.user);
    setPermissions(await auth.permissions());
  }, []);

  const register = useCallback(async (data: RegisterInput) => {
    const result = await auth.register(data);
    setUser(result.user);
    setPermissions(await auth.permissions());
  }, []);

  const logout = useCallback(async () => {
    await auth.logout();
    setUser(null);
    setPermissions([]);
    router.replace('/login');
  }, [router]);

  const updateUser = useCallback((next: AuthUser) => setUser(next), []);
  const refreshPermissions = useCallback(async () => {
    if (auth.isAuthenticated()) setPermissions(await auth.permissions());
  }, []);
  const hasPermission = useCallback((resource: Resource, action: Action) => permissions.find((entry) => entry.resource === resource && entry.action === action)?.allowed === true, [permissions]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    login,
    completeOidcLogin,
    register,
    logout,
    updateUser,
    hasPermission,
    refreshPermissions,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Zugriff auf den Auth-Zustand. Muss innerhalb von {@link AuthProvider} genutzt werden. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden.');
  }
  return ctx;
}
