import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EntraGroupResolutionError,
  EntraGroupResolverService,
  hasEntraGroupOverage,
} from "../../dist/modules/auth/oidc/entra-group-resolver.service.js";
import { IdentityProviderOperationService } from "../../dist/modules/auth/oidc/identity-provider-operation.service.js";
import {
  acceptsEmailVerificationClaim,
  supportsPkceS256,
} from "../../dist/modules/auth/oidc/oidc-provider-compatibility.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = resolve(TEST_DIRECTORY, "../..");
const PROVIDER_ID = "10000000-0000-4000-8000-000000000001";
const SUBJECT = "subject-15e";
const FIRST_GROUP = "20000000-0000-4000-8000-000000000002";
const SECOND_GROUP = "30000000-0000-4000-8000-000000000003";

type OperationPrisma = ConstructorParameters<
  typeof IdentityProviderOperationService
>[0];
type GroupCache = ConstructorParameters<typeof EntraGroupResolverService>[0];

test("Verbindungstest prüft Discovery, TLS, Issuer, Endpunkte, PKCE, JWKS und Logout getrennt", async () => {
  const originalFetch = globalThis.fetch;
  const originalAllowedHosts = process.env.OIDC_ALLOWED_PRIVATE_HOSTS;
  process.env.OIDC_ALLOWED_PRIVATE_HOSTS = "sso.example.test";
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = input.toString();
    requestedUrls.push(url);
    if (url.endsWith("/jwks")) {
      return Response.json({
        keys: [{ kty: "RSA", kid: "signing-key", n: "abc", e: "AQAB" }],
      });
    }
    return Response.json({
      issuer: "https://sso.example.test/realms/wiki",
      authorization_endpoint:
        "https://sso.example.test/realms/wiki/protocol/openid-connect/auth",
      token_endpoint:
        "https://sso.example.test/realms/wiki/protocol/openid-connect/token",
      jwks_uri: "https://sso.example.test/realms/wiki/jwks",
      code_challenge_methods_supported: ["S256"],
      end_session_endpoint:
        "https://sso.example.test/realms/wiki/protocol/openid-connect/logout",
      frontchannel_logout_supported: true,
      backchannel_logout_supported: true,
    });
  };
  try {
    const service = new IdentityProviderOperationService({
      identityProvider: {
        findUnique: async () => ({
          id: PROVIDER_ID,
          type: "GENERIC_OIDC",
          issuer: "https://sso.example.test/realms/wiki",
          discoveryUrl: null,
        }),
      },
    } as unknown as OperationPrisma);
    const result = await service.testConnection(PROVIDER_ID);

    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 7);
    assert.ok(result.checks.every((check) => check.ok));
    assert.deepEqual(result.logout, {
      endSessionEndpoint: true,
      frontchannel: true,
      backchannel: true,
    });
    assert.equal(requestedUrls.length, 2);
    assert.ok(
      requestedUrls[0]?.endsWith(
        "/realms/wiki/.well-known/openid-configuration",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAllowedHosts === undefined) {
      delete process.env.OIDC_ALLOWED_PRIVATE_HOSTS;
    } else {
      process.env.OIDC_ALLOWED_PRIVATE_HOSTS = originalAllowedHosts;
    }
  }
});

test("Entra-Verbindungstest akzeptiert das fehlende optionale PKCE-Merkmal", async () => {
  const originalFetch = globalThis.fetch;
  const originalAllowedHosts = process.env.OIDC_ALLOWED_PRIVATE_HOSTS;
  process.env.OIDC_ALLOWED_PRIVATE_HOSTS = "login.microsoft.test";
  globalThis.fetch = async (input) => {
    const url = input.toString();
    if (url.endsWith("/keys")) {
      return Response.json({
        keys: [{ kty: "RSA", kid: "entra-key", n: "abc", e: "AQAB" }],
      });
    }
    return Response.json({
      issuer: "https://login.microsoft.test/tenant/v2.0",
      authorization_endpoint:
        "https://login.microsoft.test/tenant/oauth2/v2.0/authorize",
      token_endpoint:
        "https://login.microsoft.test/tenant/oauth2/v2.0/token",
      jwks_uri: "https://login.microsoft.test/tenant/discovery/v2.0/keys",
    });
  };
  try {
    const service = new IdentityProviderOperationService({
      identityProvider: {
        findUnique: async () => ({
          id: PROVIDER_ID,
          type: "MICROSOFT_ENTRA",
          issuer: "https://login.microsoft.test/tenant/v2.0",
          discoveryUrl: null,
        }),
      },
    } as unknown as OperationPrisma);

    const result = await service.testConnection(PROVIDER_ID);
    const pkceCheck = result.checks.find((check) => check.name === "PKCE");

    assert.equal(result.ok, true);
    assert.equal(pkceCheck?.ok, true);
    assert.match(pkceCheck?.message ?? "", /Microsoft Entra/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalAllowedHosts === undefined) {
      delete process.env.OIDC_ALLOWED_PRIVATE_HOSTS;
    } else {
      process.env.OIDC_ALLOWED_PRIVATE_HOSTS = originalAllowedHosts;
    }
  }
});

test("Entra-Ausnahmen bleiben auf fehlende Metadaten und Claims begrenzt", () => {
  assert.equal(supportsPkceS256("MICROSOFT_ENTRA", undefined), true);
  assert.equal(supportsPkceS256("GENERIC_OIDC", undefined), false);
  assert.equal(supportsPkceS256("KEYCLOAK", ["S256"]), true);
  assert.equal(supportsPkceS256("MICROSOFT_ENTRA", ["plain"]), false);

  assert.equal(
    acceptsEmailVerificationClaim("MICROSOFT_ENTRA", undefined),
    true,
  );
  assert.equal(
    acceptsEmailVerificationClaim("MICROSOFT_ENTRA", false),
    false,
  );
  assert.equal(
    acceptsEmailVerificationClaim("GENERIC_OIDC", undefined),
    false,
  );
  assert.equal(acceptsEmailVerificationClaim("GENERIC_OIDC", true), true);
});

test("Entra-Overage wird ausschließlich bei hasgroups oder _claim_names.groups erkannt", () => {
  assert.equal(hasEntraGroupOverage({ groups: [FIRST_GROUP] }), false);
  assert.equal(hasEntraGroupOverage({ hasgroups: true }), true);
  assert.equal(
    hasEntraGroupOverage({ _claim_names: { groups: "src1" } }),
    true,
  );
  assert.equal(
    hasEntraGroupOverage({ _claim_names: { roles: "src1" } }),
    false,
  );
});

test("Graph-Fallback lädt transitive Objekt-IDs, folgt nur sicheren Folgelinks und cached das Ergebnis", async () => {
  const originalFetch = globalThis.fetch;
  const cachedValues: string[][] = [];
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(input.toString());
    assert.equal(
      (init?.headers as Record<string, string>).authorization,
      "Bearer graph-access-token",
    );
    if (requests.length === 1) {
      return Response.json({
        value: [{ id: FIRST_GROUP }],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=id&$skiptoken=next",
      });
    }
    return Response.json({ value: [{ id: SECOND_GROUP }] });
  };
  try {
    const resolver = new EntraGroupResolverService({
      get: async () => null,
      set: async (
        _providerId: string,
        _subject: string,
        _membershipMode: string,
        groupIds: string[],
      ) => {
        cachedValues.push(groupIds);
      },
    } as unknown as GroupCache);
    const claims = await resolver.resolveClaims(
      {
        id: PROVIDER_ID,
        type: "MICROSOFT_ENTRA",
        groupClaim: "groups",
        entraGraphFallbackEnabled: true,
        entraGraphMembershipMode: "TRANSITIVE",
        entraGraphCacheTtlMinutes: 15,
      },
      {
        sub: SUBJECT,
        hasgroups: true,
        _claim_names: { groups: "src1" },
        _claim_sources: {
          src1: { endpoint: "https://evil.example.test/groups" },
        },
      },
      "graph-access-token",
    );

    assert.deepEqual(claims.groups, [FIRST_GROUP, SECOND_GROUP]);
    assert.deepEqual(cachedValues, [[FIRST_GROUP, SECOND_GROUP]]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((url) => url.startsWith("https://graph.microsoft.com/")));
    assert.ok(requests.every((url) => !url.includes("evil.example.test")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Overage ohne aktivierten Fallback wird statt einer unvollständigen Rechteentscheidung abgewiesen", async () => {
  const resolver = new EntraGroupResolverService({
    get: async () => null,
    set: async () => undefined,
  } as unknown as GroupCache);
  await assert.rejects(
    resolver.resolveClaims(
      {
        id: PROVIDER_ID,
        type: "MICROSOFT_ENTRA",
        groupClaim: "groups",
        entraGraphFallbackEnabled: false,
        entraGraphMembershipMode: "DIRECT",
        entraGraphCacheTtlMinutes: 15,
      },
      { sub: SUBJECT, hasgroups: true },
      undefined,
    ),
    (error: unknown) =>
      error instanceof EntraGroupResolutionError &&
      error.code === "graph_fallback_disabled",
  );
});

test("Phase 15E besitzt eine reversible Prisma-Migration und dokumentierte Provider-Hilfe", async () => {
  const migrationDirectory = resolve(
    API_DIRECTORY,
    "prisma/migrations/20260724175451_add_oidc_provider_operations",
  );
  const [migration, rollback, setupPage, germanMessages] = await Promise.all([
    readFile(resolve(migrationDirectory, "migration.sql"), "utf8"),
    readFile(resolve(migrationDirectory, "rollback.sql"), "utf8"),
    readFile(
      resolve(API_DIRECTORY, "../web/src/app/settings/setup/page.tsx"),
      "utf8",
    ),
    readFile(
      resolve(API_DIRECTORY, "../web/src/messages/de.json"),
      "utf8",
    ),
  ]);

  assert.match(migration, /"entra_graph_fallback_enabled"/);
  assert.match(migration, /CREATE TYPE "EntraGraphMembershipMode"/);
  assert.match(rollback, /DROP TYPE IF EXISTS "EntraGraphMembershipMode"/);
  assert.match(setupPage, /IdentityProviderGuide/);
  assert.match(germanMessages, /Keycloak/);
  assert.match(germanMessages, /User Federation/);
  assert.match(germanMessages, /Authentik, Okta, Zitadel/);
});
