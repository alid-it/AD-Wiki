import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  IdentityProviderConnectionCheck,
  IdentityProviderConnectionTest,
} from "@ad-wiki/shared-types";
import { PrismaService } from "@/prisma/prisma.service";
import {
  assertSafeOidcUrl,
  parseOidcUrl,
} from "@/modules/auth/oidc/oidc-url-security";
import { supportsPkceS256 } from "@/modules/auth/oidc/oidc-provider-compatibility";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;

type Metadata = Record<string, unknown>;

/** Geheimnisfreier Betriebscheck für gespeicherte OIDC-Provider. */
@Injectable()
export class IdentityProviderOperationService {
  constructor(private readonly prisma: PrismaService) {}

  async testConnection(
    providerId: string,
  ): Promise<IdentityProviderConnectionTest> {
    const provider = await this.prisma.identityProvider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        type: true,
        issuer: true,
        discoveryUrl: true,
      },
    });
    if (!provider) {
      throw new NotFoundException("SSO-Anbieter nicht gefunden.");
    }

    const startedAt = Date.now();
    const issuer = await assertSafeOidcUrl(provider.issuer, "Issuer");
    const discoveryUrl = provider.discoveryUrl
      ? await assertSafeOidcUrl(provider.discoveryUrl, "Discovery-URL")
      : new URL(
          `${issuer.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`,
          issuer.origin,
        );
    const checks: IdentityProviderConnectionCheck[] = [];
    let metadata: Metadata | null = null;

    try {
      metadata = await fetchJson(discoveryUrl);
      checks.push(
        check("DISCOVERY", true, "Discovery-Metadaten wurden geladen."),
        check(
          "TLS",
          discoveryUrl.protocol === "https:",
          discoveryUrl.protocol === "https:"
            ? "Die TLS-Vertrauenskette wurde vom System akzeptiert."
            : "Die Discovery-Verbindung verwendet kein TLS.",
        ),
      );
    } catch {
      checks.push(
        check(
          "DISCOVERY",
          false,
          "Discovery-Metadaten konnten nicht sicher geladen werden.",
        ),
        check(
          "TLS",
          false,
          "TLS-Verbindung oder Zertifikatsvertrauen konnte nicht bestätigt werden.",
        ),
      );
    }

    const discoveredIssuer = stringMetadata(metadata, "issuer");
    checks.push(
      check(
        "ISSUER",
        discoveredIssuer === provider.issuer,
        discoveredIssuer === provider.issuer
          ? "Der veröffentlichte Issuer stimmt exakt überein."
          : "Der veröffentlichte Issuer stimmt nicht exakt mit der Konfiguration überein.",
      ),
    );

    const authorizationEndpoint = endpointMetadata(
      metadata,
      "authorization_endpoint",
    );
    checks.push(
      check(
        "AUTHORIZATION_ENDPOINT",
        authorizationEndpoint !== null,
        authorizationEndpoint
          ? "Der Authorization-Endpunkt ist sicher veröffentlicht."
          : "Ein sicherer Authorization-Endpunkt fehlt.",
      ),
    );

    const tokenEndpoint = endpointMetadata(metadata, "token_endpoint");
    checks.push(
      check(
        "TOKEN_ENDPOINT",
        tokenEndpoint !== null,
        tokenEndpoint
          ? "Der Token-Endpunkt ist sicher veröffentlicht."
          : "Ein sicherer Token-Endpunkt fehlt.",
      ),
    );

    const pkceMethods = metadata?.code_challenge_methods_supported;
    const supportsS256 = supportsPkceS256(provider.type, pkceMethods);
    const entraWithoutAdvertisement =
      provider.type === "MICROSOFT_ENTRA" && pkceMethods === undefined;
    checks.push(
      check(
        "PKCE",
        supportsS256,
        entraWithoutAdvertisement
          ? "Microsoft Entra unterstützt PKCE mit S256; das optionale Discovery-Merkmal wird nicht veröffentlicht."
          : supportsS256
          ? "PKCE mit S256 wird unterstützt."
          : "PKCE mit S256 wurde nicht veröffentlicht.",
      ),
    );

    const jwksUrl = endpointMetadata(metadata, "jwks_uri");
    let jwksOk = false;
    if (jwksUrl) {
      try {
        const jwks = await fetchJson(jwksUrl);
        jwksOk = hasUsableJwk(jwks);
      } catch {
        jwksOk = false;
      }
    }
    checks.push(
      check(
        "JWKS",
        jwksOk,
        jwksOk
          ? "Mindestens ein öffentlicher Signaturschlüssel ist abrufbar."
          : "Es konnte kein verwendbarer öffentlicher Signaturschlüssel bestätigt werden.",
      ),
    );

    const endSessionEndpoint =
      endpointMetadata(metadata, "end_session_endpoint") !== null;
    const frontchannel =
      metadata?.frontchannel_logout_supported === true ||
      metadata?.frontchannel_logout_session_supported === true;
    const backchannel =
      metadata?.backchannel_logout_supported === true ||
      metadata?.backchannel_logout_session_supported === true;

    return {
      providerId: provider.id,
      ok: checks.every((item) => item.ok),
      testedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      discoveryUrl: discoveryUrl.toString(),
      issuer: provider.issuer,
      checks,
      logout: {
        endSessionEndpoint,
        frontchannel,
        backchannel,
      },
    };
  }
}

function check(
  name: IdentityProviderConnectionCheck["name"],
  ok: boolean,
  message: string,
): IdentityProviderConnectionCheck {
  return { name, ok, message };
}

function endpointMetadata(
  metadata: Metadata | null,
  name: string,
): URL | null {
  const value = stringMetadata(metadata, name);
  if (!value) return null;
  try {
    return parseOidcUrl(value, name);
  } catch {
    return null;
  }
}

function stringMetadata(
  metadata: Metadata | null,
  name: string,
): string | null {
  const value = metadata?.[name];
  return typeof value === "string" && value.length <= 2_000 ? value : null;
}

async function fetchJson(url: URL): Promise<Metadata> {
  const safeUrl = await assertSafeOidcUrl(url, "OIDC-Endpunkt");
  const response = await fetch(safeUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("http");
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("size");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("size");
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("json");
  }
  return parsed as Metadata;
}

function hasUsableJwk(jwks: Metadata): boolean {
  const keys = jwks.keys;
  return (
    Array.isArray(keys) &&
    keys.some(
      (key) =>
        typeof key === "object" &&
        key !== null &&
        !Array.isArray(key) &&
        typeof (key as Record<string, unknown>).kty === "string" &&
        typeof (key as Record<string, unknown>).kid === "string",
    )
  );
}
