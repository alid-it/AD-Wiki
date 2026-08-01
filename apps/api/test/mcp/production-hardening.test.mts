import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { McpOAuthService, OAuthRequestError } from "../../dist/modules/mcp/mcp-oauth.service.js";
import { getMcpProductionConfig } from "../../dist/modules/mcp/mcp-production.config.js";
import { McpRateLimitService } from "../../dist/modules/mcp/mcp-rate-limit.service.js";
import { structuredLogRecord } from "../../dist/common/logging/structured-logger.js";

type PrismaDependency = ConstructorParameters<typeof McpOAuthService>[0];
type TokenDependency = ConstructorParameters<typeof McpOAuthService>[1];
type AuditDependency = ConstructorParameters<typeof McpOAuthService>[2];

function oauthService(prisma: object = {}, tokens: object = {}, audit: object = { log: async () => undefined }) {
  return new McpOAuthService(
    prisma as PrismaDependency,
    tokens as TokenDependency,
    audit as AuditDependency,
  );
}

test("Protected Resource Metadata und Authorization-Server-Metadaten sind RFC-konform und kanonisch", () => {
  const service = oauthService();
  const resource = service.protectedResourceMetadata();
  const server = service.authorizationServerMetadata();
  assert.equal(resource.resource, "http://localhost:4000/mcp");
  assert.deepEqual(resource.authorization_servers, ["http://localhost:4000"]);
  assert.deepEqual(resource.scopes_supported, ["mcp:read", "mcp:write"]);
  assert.equal(server.authorization_endpoint, "http://localhost:4000/oauth/authorize");
  assert.equal(server.registration_endpoint, "http://localhost:4000/oauth/register");
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(server.token_endpoint_auth_methods_supported, ["none"]);
});

test("Produktionskonfiguration erzwingt HTTPS, Host-/Origin-Allowlisten und Redis", () => {
  const previous = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    process.env.MCP_PUBLIC_URL = "http://wiki.example.de/mcp";
    assert.throws(() => getMcpProductionConfig(), /HTTPS/);
    process.env.MCP_PUBLIC_URL = "https://wiki.example.de/mcp";
    delete process.env.MCP_ALLOWED_HOSTS;
    delete process.env.MCP_ALLOWED_ORIGINS;
    assert.throws(() => getMcpProductionConfig(), /erforderlich/);
    process.env.MCP_ALLOWED_HOSTS = "wiki.example.de";
    process.env.MCP_ALLOWED_ORIGINS = "https://wiki.example.de";
    assert.equal(getMcpProductionConfig().resourceUrl.href, "https://wiki.example.de/mcp");
  } finally {
    process.env = previous;
  }
});

test("Dynamic Client Registration akzeptiert nur öffentliche Clients mit sicheren Redirect-URIs", async () => {
  const created: Record<string, unknown>[] = [];
  const service = oauthService({
    mcpOAuthClient: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { ...data, createdAt: new Date("2026-07-15T00:00:00Z") };
      },
    },
  });
  const client = await service.registerClient({
    client_name: "Codex",
    redirect_uris: ["http://localhost:1455/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  assert.match(client.client_id, /^ad_wiki_oauth_/);
  assert.equal(created[0]?.tokenEndpointAuthMethod, "none");
  await assert.rejects(
    service.registerClient({ redirect_uris: ["http://attacker.example/callback"] }),
    (error: unknown) => error instanceof OAuthRequestError && error.code === "invalid_redirect_uri",
  );
});

test("OAuth-Autorisierung bindet resource, PKCE und einmalig rotierende Tokens", async () => {
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  let claimCount = 0;
  const accessInputs: Record<string, unknown>[] = [];
  const refreshRows: Record<string, unknown>[] = [];
  const client = { clientId: "ad_wiki_oauth_client", clientName: "Codex" };
  const record = {
    id: "code-id", codeHash: "hash", clientId: client.clientId, userId: "user-id",
    redirectUri: "http://localhost:1455/callback", codeChallenge: challenge,
    resource: "http://localhost:4000/mcp", scopes: ["mcp:read", "mcp:write"],
    expiresAt: new Date(Date.now() + 60_000), usedAt: null, client,
  };
  const service = oauthService({
    mcpOAuthAuthorizationCode: {
      findUnique: async () => record,
      updateMany: async () => ({ count: claimCount++ === 0 ? 1 : 0 }),
    },
    mcpOAuthClient: { update: async () => client },
    mcpOAuthRefreshToken: { create: async ({ data }: { data: Record<string, unknown> }) => { refreshRows.push(data); return data; } },
  }, {
    createOAuthAccessToken: async (input: Record<string, unknown>) => {
      accessInputs.push(input);
      return { token: "ad_wiki_mcp_access", expiresAt: input.expiresAt };
    },
  });
  const body = {
    grant_type: "authorization_code", code: "opaque", client_id: client.clientId,
    redirect_uri: record.redirectUri, code_verifier: verifier, resource: record.resource,
  };
  const result = await service.exchange(body);
  assert.equal(result.token_type, "Bearer");
  assert.equal(result.expires_in, 900);
  assert.match(result.refresh_token, /^ad_wiki_refresh_/);
  assert.deepEqual(accessInputs[0]?.requestedScopes, ["mcp:read", "mcp:write"]);
  assert.equal(typeof refreshRows[0]?.tokenHash, "string");
  assert.equal(JSON.stringify(refreshRows).includes(result.refresh_token), false);
  await assert.rejects(service.exchange(body), (error: unknown) => error instanceof OAuthRequestError && error.code === "invalid_grant");
});

test("strukturierte Logs redigieren Geheimnisse rekursiv", () => {
  const record = structuredLogRecord("info", {
    event: "test", authorization: "Bearer secret", nested: { refreshToken: "secret", safe: "ok" },
  });
  assert.equal(record.authorization, "[REDACTED]");
  assert.deepEqual(record.nested, { refreshToken: "[REDACTED]", safe: "ok" });
  assert.equal(JSON.stringify(record).includes("Bearer secret"), false);
});

test("Wiederverwendung eines rotierten Refresh-Tokens widerruft die gesamte Token-Familie", async () => {
  const updates: Record<string, unknown>[] = [];
  const service = oauthService({
    mcpOAuthRefreshToken: {
      findUnique: async () => ({
        id: "refresh-id", tokenHash: "hash", familyId: "family-id",
        clientId: "client-id", userId: "user-id", resource: "http://localhost:4000/mcp",
        scopes: ["mcp:read"], expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(), rotatedAt: new Date(), client: { clientId: "client-id", clientName: "Codex" },
      }),
      updateMany: async (input: Record<string, unknown>) => { updates.push(input); return { count: 1 }; },
    },
  });
  await assert.rejects(
    service.exchange({
      grant_type: "refresh_token", refresh_token: "old-token", client_id: "client-id",
      resource: "http://localhost:4000/mcp",
    }),
    (error: unknown) => error instanceof OAuthRequestError && error.code === "invalid_grant",
  );
  assert.deepEqual(updates[0]?.where, { familyId: "family-id", revokedAt: null });
});

test("OAuth-Refresh verwendet die gebundene Resource, wenn Codex resource nicht erneut sendet", async () => {
  const created: Record<string, unknown>[] = [];
  const record = {
    id: "refresh-id", tokenHash: "hash", familyId: "family-id",
    clientId: "client-id", userId: "user-id", resource: "http://localhost:4000/mcp",
    scopes: ["mcp:read", "mcp:write"], expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null, rotatedAt: null, client: { clientId: "client-id", clientName: "Codex" },
  };
  const service = oauthService({
    mcpOAuthRefreshToken: {
      findUnique: async () => record,
      updateMany: async () => ({ count: 1 }),
      create: async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; },
    },
  }, {
    createOAuthAccessToken: async (input: Record<string, unknown>) => ({
      token: "ad_wiki_mcp_access", expiresAt: input.expiresAt,
    }),
  });

  const result = await service.exchange({
    grant_type: "refresh_token", refresh_token: "current-token", client_id: "client-id",
  });

  assert.equal(result.token_type, "Bearer");
  assert.equal(created[0]?.resource, record.resource);
});

test("Lasttest: parallele MCP-Schreibzugriffe werden exakt am konfigurierten Limit abgeschnitten", async () => {
  const previous = { ...process.env };
  try {
    process.env.NODE_ENV = "test";
    delete process.env.REDIS_URL;
    process.env.MCP_RATE_LIMIT_WRITE = "30";
    const limiter = new McpRateLimitService();
    await limiter.onModuleInit();
    const results = await Promise.all(Array.from({ length: 200 }, () => limiter.consume("load-token", "write")));
    assert.equal(results.filter((entry) => entry.allowed).length, 30);
    assert.equal(results.filter((entry) => !entry.allowed).length, 170);
    await limiter.onModuleDestroy();
  } finally {
    process.env = previous;
  }
});

test("Codex- und Claude-Beispiele enthalten den getesteten Streamable-HTTP-Endpunkt", () => {
  const root = resolve(process.cwd(), "../..");
  const codex = readFileSync(resolve(root, "docs/mcp/codex-config.toml"), "utf8");
  const claude = JSON.parse(readFileSync(resolve(root, "docs/mcp/claude-config.json"), "utf8")) as {
    mcpServers: Record<string, { type: string; url: string }>;
  };
  assert.match(codex, /url = "https:\/\/wiki\.example\.de\/mcp"/);
  assert.doesNotMatch(codex, /oauth_resource/);
  assert.deepEqual(claude.mcpServers["ad-wiki"], { type: "http", url: "https://wiki.example.de/mcp" });
});
