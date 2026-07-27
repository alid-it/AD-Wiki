import { z } from 'zod';
import {
  AuthResultSchema,
  AuthUserSchema,
  MessageResultSchema,
  LinkedExternalIdentitySchema,
  OidcAccountActionStartSchema,
  OidcLoginProviderSchema,
  IdentitySyncPreviewSchema,
  IdentityProviderConnectionTestSchema,
  RefreshResultSchema,
  type AuthResult,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type MessageResult,
  type LinkedExternalIdentity,
  type OidcAccountActionStart,
  type OidcLoginProvider,
  type IdentitySyncPreview,
  type IdentitySyncPreviewInput,
  type IdentityProviderConnectionTest,
  type RequestPasswordResetInput,
  type RegisterInput,
  type ResetPasswordInput,
  AclEntrySchema,
  type AclEntry,
} from '@ad-wiki/shared-types';
import { requestData } from '../http';
import { getConfig } from '../config';
import { getTokenStore } from '../token-store';

/** Speichert das Token-Paar aus einem erfolgreichen Login/Register. */
function persistTokens(result: AuthResult): AuthResult {
  getTokenStore().setTokens({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
  return result;
}

/** Einloggen und Tokens ablegen (`POST /auth/login`). */
export async function login(input: LoginInput): Promise<AuthResult> {
  const result = await requestData(AuthResultSchema, '/auth/login', {
    method: 'POST',
    body: input,
  });
  return persistTokens(result);
}

/** Aktive, öffentlich sichtbare OIDC-Anbieter für die Loginseite. */
export function oidcProviders(signal?: AbortSignal): Promise<OidcLoginProvider[]> {
  return requestData(z.array(OidcLoginProviderSchema), '/auth/oidc/providers', {
    signal,
  });
}

/** Absolute API-URL zum browserbasierten OIDC-Start. */
export function oidcStartUrl(providerSlug: string): string {
  return `${getConfig().baseUrl}/auth/oidc/${encodeURIComponent(providerSlug)}/start`;
}

/** Eigene, sicher reduzierte Liste verknüpfter externer Identitäten. */
export function linkedOidcIdentities(
  signal?: AbortSignal,
): Promise<LinkedExternalIdentity[]> {
  return requestData(
    z.array(LinkedExternalIdentitySchema),
    '/auth/oidc/identities',
    { auth: true, signal },
  );
}

/** Startet die erzwungene externe Neuanmeldung zum Verknüpfen. */
export function startOidcLink(
  providerSlug: string,
): Promise<OidcAccountActionStart> {
  return requestData(
    OidcAccountActionStartSchema,
    `/auth/oidc/${encodeURIComponent(providerSlug)}/link/start`,
    { method: 'POST', auth: true },
  );
}

/** Startet die externe Neuanmeldung zum kontrollierten Entfernen. */
export function startOidcUnlink(
  identityId: string,
): Promise<OidcAccountActionStart> {
  return requestData(
    OidcAccountActionStartSchema,
    `/auth/oidc/identities/${encodeURIComponent(identityId)}/unlink/start`,
    { method: 'POST', auth: true },
  );
}

/** Prüft Gruppen- und Rollen-Mappings mit Beispiel-Claims ohne Daten zu ändern. */
export function previewOidcSynchronization(
  providerId: string,
  input: IdentitySyncPreviewInput,
): Promise<IdentitySyncPreview> {
  return requestData(
    IdentitySyncPreviewSchema,
    `/auth/oidc/providers/${encodeURIComponent(providerId)}/sync/preview`,
    { method: 'POST', auth: true, body: input },
  );
}

/** Prüft Discovery, TLS, JWKS, Endpunkte, PKCE und Logout-Metadaten. */
export function testOidcProviderConnection(
  providerId: string,
): Promise<IdentityProviderConnectionTest> {
  return requestData(
    IdentityProviderConnectionTestSchema,
    `/auth/oidc/providers/${encodeURIComponent(providerId)}/test-connection`,
    { method: 'POST', auth: true },
  );
}

/** Tauscht den kurzlebigen OIDC-Code gegen das interne AD-Wiki-Tokenpaar. */
export async function exchangeOidcLoginCode(code: string): Promise<AuthResult> {
  const result = await requestData(AuthResultSchema, '/auth/oidc/exchange', {
    method: 'POST',
    body: { code },
  });
  return persistTokens(result);
}

/** Registrieren und direkt einloggen (`POST /auth/register`). */
export async function register(input: RegisterInput): Promise<AuthResult> {
  const result = await requestData(AuthResultSchema, '/auth/register', {
    method: 'POST',
    body: input,
  });
  return persistTokens(result);
}

/** Fordert kontenneutral eine Passwort-Reset-Mail an. */
export function forgotPassword(input: RequestPasswordResetInput): Promise<MessageResult> {
  return requestData(MessageResultSchema, '/auth/forgot-password', {
    method: 'POST',
    body: input,
  });
}

/** Setzt das Passwort mit einem Einmal-Token neu. */
export function resetPassword(input: ResetPasswordInput): Promise<MessageResult> {
  return requestData(MessageResultSchema, '/auth/reset-password', {
    method: 'POST',
    body: input,
  });
}

/** Aktuellen Benutzer abrufen (`GET /auth/me`, geschützt). */
export function me(signal?: AbortSignal): Promise<AuthUser> {
  return requestData(AuthUserSchema, '/auth/me', { auth: true, signal });
}

/** Effektive ACLs des angemeldeten Nutzers (`GET /auth/permissions`). */
export function permissions(signal?: AbortSignal): Promise<AclEntry[]> {
  return requestData(z.array(AclEntrySchema), '/auth/permissions', { auth: true, signal });
}

/** Access- und Refresh-Token manuell rotieren (`POST /auth/refresh`). */
export async function refresh(): Promise<void> {
  const store = getTokenStore();
  const refreshToken = store.getRefreshToken();
  if (!refreshToken) return;

  const result = await requestData(RefreshResultSchema, '/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  store.setTokens({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
}

/** Session beenden und lokale Tokens verwerfen (`POST /auth/logout`). */
export async function logout(): Promise<void> {
  const store = getTokenStore();
  const refreshToken = store.getRefreshToken();
  if (refreshToken) {
    try {
      await requestData(z.unknown(), '/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      });
    } catch {
      // Logout ist best effort – lokale Tokens werden trotzdem entfernt.
    }
  }
  store.clear();
}

/**
 * Passwort ändern (`POST /auth/change-password`, geschützt). Da der Server
 * alle Sessions verwirft, werden anschließend die lokalen Tokens entfernt –
 * der Aufrufer sollte danach zum Login leiten.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  await requestData(z.unknown(), '/auth/change-password', {
    method: 'POST',
    body: input,
    auth: true,
  });
  getTokenStore().clear();
}

/** Prüft, ob aktuell ein Access-Token vorliegt (grobe Anmeldeprüfung). */
export function isAuthenticated(): boolean {
  return getTokenStore().getAccessToken() !== null;
}
