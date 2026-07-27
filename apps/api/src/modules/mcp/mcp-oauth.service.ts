import { Injectable, NotFoundException } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AuditService } from "@/modules/audit/audit.service";
import { McpTokenService } from "@/modules/mcp/mcp-token.service";
import { getMcpProductionConfig, MCP_OAUTH_SCOPES } from "@/modules/mcp/mcp-production.config";
import { PrismaService } from "@/prisma/prisma.service";

export class OAuthRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

@Injectable()
export class McpOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: McpTokenService,
    private readonly audit: AuditService,
  ) {}

  protectedResourceMetadata() {
    const config = getMcpProductionConfig();
    return {
      resource: canonical(config.resourceUrl),
      authorization_servers: [canonical(config.issuerUrl)],
      bearer_methods_supported: ["header"],
      scopes_supported: [...MCP_OAUTH_SCOPES],
      resource_name: "AD-Wiki MCP",
      resource_documentation: new URL("/settings/mcp", config.webUrl).href,
    };
  }

  authorizationServerMetadata() {
    const { issuerUrl } = getMcpProductionConfig();
    return {
      issuer: canonical(issuerUrl),
      authorization_endpoint: new URL("/oauth/authorize", issuerUrl).href,
      token_endpoint: new URL("/oauth/token", issuerUrl).href,
      registration_endpoint: new URL("/oauth/register", issuerUrl).href,
      revocation_endpoint: new URL("/oauth/revoke", issuerUrl).href,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [...MCP_OAUTH_SCOPES],
    };
  }

  async registerClient(body: Record<string, unknown>) {
    const redirectUris = stringArray(body.redirect_uris, "redirect_uris", 10);
    if (redirectUris.length === 0 || redirectUris.some((uri) => !isSafeRedirectUri(uri))) {
      throw new OAuthRequestError("invalid_redirect_uri", "redirect_uris enthält eine nicht erlaubte URI.");
    }
    const grantTypes = optionalStringArray(body.grant_types) ?? ["authorization_code", "refresh_token"];
    const responseTypes = optionalStringArray(body.response_types) ?? ["code"];
    const authMethod = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
    if (!grantTypes.includes("authorization_code") || grantTypes.some((value) => !["authorization_code", "refresh_token"].includes(value))) {
      throw new OAuthRequestError("invalid_client_metadata", "Nur authorization_code und refresh_token werden unterstützt.");
    }
    if (responseTypes.length !== 1 || responseTypes[0] !== "code" || authMethod !== "none") {
      throw new OAuthRequestError("invalid_client_metadata", "Der Client muss response_type=code und token_endpoint_auth_method=none verwenden.");
    }
    const clientName = typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 200)
      : "MCP Client";
    const clientId = `ad_wiki_oauth_${randomBytes(24).toString("base64url")}`;
    const client = await this.prisma.mcpOAuthClient.create({
      data: { clientId, clientName, redirectUris, grantTypes, responseTypes, tokenEndpointAuthMethod: authMethod },
    });
    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    };
  }

  async startAuthorization(query: Record<string, unknown>): Promise<string> {
    const responseType = requiredString(query.response_type, "response_type");
    const clientId = requiredString(query.client_id, "client_id");
    const redirectUri = requiredString(query.redirect_uri, "redirect_uri");
    const codeChallenge = requiredString(query.code_challenge, "code_challenge");
    const challengeMethod = requiredString(query.code_challenge_method, "code_challenge_method");
    const resource = requiredString(query.resource, "resource");
    const state = optionalString(query.state, "state", 1024);
    if (responseType !== "code" || challengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      throw new OAuthRequestError("invalid_request", "OAuth 2.1 erfordert response_type=code und PKCE S256.");
    }
    const config = getMcpProductionConfig();
    if (canonical(new URL(resource)) !== canonical(config.resourceUrl)) {
      throw new OAuthRequestError("invalid_target", "Der resource-Parameter gehört nicht zu diesem MCP-Server.");
    }
    const client = await this.prisma.mcpOAuthClient.findUnique({ where: { clientId } });
    if (!client || !client.redirectUris.includes(redirectUri)) {
      throw new OAuthRequestError("invalid_client", "Client oder Redirect-URI ist ungültig.", 401);
    }
    const scopes = parseScopes(optionalString(query.scope, "scope", 500) ?? "mcp:read");
    await this.cleanupExpired();
    const request = await this.prisma.mcpOAuthAuthorizationRequest.create({
      data: {
        clientId,
        redirectUri,
        state,
        codeChallenge,
        resource: canonical(config.resourceUrl),
        scopes,
        expiresAt: new Date(Date.now() + config.authorizationRequestTtlSeconds * 1000),
      },
    });
    const approvalUrl = new URL("/settings/mcp/authorize", config.webUrl);
    approvalUrl.searchParams.set("request_id", request.id);
    return approvalUrl.href;
  }

  async authorizationRequest(id: string) {
    const request = await this.prisma.mcpOAuthAuthorizationRequest.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!request || request.expiresAt.getTime() <= Date.now()) {
      if (request) await this.prisma.mcpOAuthAuthorizationRequest.deleteMany({ where: { id } });
      throw new NotFoundException("Die OAuth-Anfrage ist abgelaufen oder unbekannt.");
    }
    return {
      id: request.id,
      clientName: request.client.clientName,
      redirectUri: request.redirectUri,
      scopes: request.scopes,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  async approve(id: string, userId: string, ipAddress?: string): Promise<string> {
    const request = await this.prisma.mcpOAuthAuthorizationRequest.findUnique({
      where: { id }, include: { client: true },
    });
    if (!request || request.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException("Die OAuth-Anfrage ist abgelaufen oder unbekannt.");
    }
    const code = `ad_wiki_code_${randomBytes(32).toString("base64url")}`;
    const config = getMcpProductionConfig();
    await this.prisma.$transaction([
      this.prisma.mcpOAuthAuthorizationRequest.delete({ where: { id } }),
      this.prisma.mcpOAuthAuthorizationCode.create({
        data: {
          codeHash: hash(code), clientId: request.clientId, userId,
          redirectUri: request.redirectUri, codeChallenge: request.codeChallenge,
          resource: request.resource, scopes: request.scopes,
          expiresAt: new Date(Date.now() + config.authorizationCodeTtlSeconds * 1000),
        },
      }),
    ]);
    await this.audit.log(userId, "mcp.oauth_authorized", "mcp_oauth_client", request.clientId, {
      clientName: request.client.clientName, scopes: request.scopes,
    }, ipAddress);
    return authorizationRedirect(request.redirectUri, { code, state: request.state });
  }

  async deny(id: string): Promise<string> {
    const request = await this.prisma.mcpOAuthAuthorizationRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException("Die OAuth-Anfrage ist unbekannt.");
    await this.prisma.mcpOAuthAuthorizationRequest.delete({ where: { id } });
    return authorizationRedirect(request.redirectUri, {
      error: "access_denied", error_description: "Der Benutzer hat den Zugriff abgelehnt.", state: request.state,
    });
  }

  async exchange(body: Record<string, unknown>): Promise<OAuthTokenResponse> {
    const grantType = requiredString(body.grant_type, "grant_type");
    if (grantType === "authorization_code") return this.exchangeCode(body);
    if (grantType === "refresh_token") return this.exchangeRefreshToken(body);
    throw new OAuthRequestError("unsupported_grant_type", "Der grant_type wird nicht unterstützt.");
  }

  async revoke(body: Record<string, unknown>): Promise<void> {
    const token = requiredString(body.token, "token");
    const clientId = optionalString(body.client_id, "client_id", 200);
    const tokenHash = hash(token);
    const refresh = await this.prisma.mcpOAuthRefreshToken.findUnique({ where: { tokenHash } });
    if (refresh && (!clientId || refresh.clientId === clientId)) {
      await this.prisma.mcpOAuthRefreshToken.updateMany({
        where: { id: refresh.id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      return;
    }
    await this.prisma.mcpAccessToken.updateMany({
      where: { tokenHash, ...(clientId ? { oauthClientId: clientId } : {}) }, data: { revokedAt: new Date() },
    });
  }

  private async exchangeCode(body: Record<string, unknown>): Promise<OAuthTokenResponse> {
    const code = requiredString(body.code, "code");
    const clientId = requiredString(body.client_id, "client_id");
    const redirectUri = requiredString(body.redirect_uri, "redirect_uri");
    const verifier = requiredString(body.code_verifier, "code_verifier");
    const resource = requiredString(body.resource, "resource");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      throw new OAuthRequestError("invalid_grant", "Der PKCE code_verifier ist ungültig.");
    }
    const record = await this.prisma.mcpOAuthAuthorizationCode.findUnique({
      where: { codeHash: hash(code) }, include: { client: true },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()
      || record.clientId !== clientId || record.redirectUri !== redirectUri
      || canonical(new URL(resource)) !== record.resource || !pkceMatches(verifier, record.codeChallenge)) {
      throw new OAuthRequestError("invalid_grant", "Autorisierungscode oder PKCE-Prüfung ist ungültig.");
    }
    const claimed = await this.prisma.mcpOAuthAuthorizationCode.updateMany({
      where: { id: record.id, usedAt: null }, data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new OAuthRequestError("invalid_grant", "Der Autorisierungscode wurde bereits verwendet.");
    await this.prisma.mcpOAuthClient.update({ where: { clientId }, data: { lastUsedAt: new Date() } });
    return this.issueTokens(record.userId, record.client, record.resource, record.scopes);
  }

  private async exchangeRefreshToken(body: Record<string, unknown>): Promise<OAuthTokenResponse> {
    const token = requiredString(body.refresh_token, "refresh_token");
    const clientId = requiredString(body.client_id, "client_id");
    const requestedResource = optionalString(body.resource, "resource", 4096);
    const record = await this.prisma.mcpOAuthRefreshToken.findUnique({
      where: { tokenHash: hash(token) }, include: { client: true },
    });
    if (record?.rotatedAt) {
      await this.prisma.mcpOAuthRefreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() },
      });
      throw new OAuthRequestError("invalid_grant", "Wiederverwendung eines rotierten Refresh-Tokens erkannt; die Token-Familie wurde widerrufen.");
    }
    if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()
      || record.clientId !== clientId || !matchesBoundResource(requestedResource, record.resource)) {
      throw new OAuthRequestError("invalid_grant", "Der Refresh-Token ist ungültig oder abgelaufen.");
    }
    const rotated = await this.prisma.mcpOAuthRefreshToken.updateMany({
      where: { id: record.id, revokedAt: null, rotatedAt: null }, data: { rotatedAt: new Date(), revokedAt: new Date() },
    });
    if (rotated.count !== 1) throw new OAuthRequestError("invalid_grant", "Der Refresh-Token wurde bereits verwendet.");
    return this.issueTokens(record.userId, record.client, record.resource, record.scopes, record.familyId);
  }

  private async issueTokens(
    userId: string,
    client: { clientId: string; clientName: string },
    resource: string,
    scopes: string[],
    familyId: string = randomUUID(),
  ): Promise<OAuthTokenResponse> {
    const config = getMcpProductionConfig();
    const accessExpiresAt = new Date(Date.now() + config.accessTokenTtlSeconds * 1000);
    const access = await this.tokens.createOAuthAccessToken({
      userId, clientId: client.clientId, clientName: client.clientName,
      resource, requestedScopes: scopes, expiresAt: accessExpiresAt,
    });
    const refreshToken = `ad_wiki_refresh_${randomBytes(48).toString("base64url")}`;
    await this.prisma.mcpOAuthRefreshToken.create({
      data: {
        tokenHash: hash(refreshToken), familyId, clientId: client.clientId, userId, resource, scopes,
        expiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000),
      },
    });
    return {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
    };
  }

  @Interval(60 * 60 * 1000)
  async cleanupExpired(): Promise<void> {
    const now = new Date();
    const retention = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await Promise.all([
      this.prisma.mcpOAuthAuthorizationRequest.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.mcpOAuthAuthorizationCode.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.mcpOAuthRefreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: retention } }] },
      }),
      this.prisma.mcpAccessToken.deleteMany({
        where: {
          oauthClientId: { not: null },
          OR: [{ expiresAt: { lt: retention } }, { revokedAt: { lt: retention } }],
        },
      }),
    ]);
  }
}

function parseScopes(value: string): string[] {
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (!scopes.includes("mcp:read") || scopes.some((scope) => !MCP_OAUTH_SCOPES.includes(scope as typeof MCP_OAUTH_SCOPES[number]))) {
    throw new OAuthRequestError("invalid_scope", "Erlaubt sind mcp:read und optional mcp:write.");
  }
  return scopes;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new OAuthRequestError("invalid_request", `${name} fehlt oder ist ungültig.`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new OAuthRequestError("invalid_request", `${name} ist ungültig.`);
  return value;
}

function stringArray(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== "string")) {
    throw new OAuthRequestError("invalid_client_metadata", `${name} ist ungültig.`);
  }
  return [...new Set(value as string[])];
}

function optionalStringArray(value: unknown): string[] | null {
  return value === undefined ? null : stringArray(value, "Client-Metadaten", 10);
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function authorizationRedirect(uri: string, params: Record<string, string | null>): string {
  const target = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== null) target.searchParams.set(key, value);
  return target.href;
}

function pkceMatches(verifier: string, expected: string): boolean {
  const actual = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(url: URL): string {
  const copy = new URL(url);
  copy.protocol = copy.protocol.toLowerCase();
  copy.hostname = copy.hostname.toLowerCase();
  copy.hash = "";
  return copy.href.replace(/\/$/, "");
}

/** Beim Refresh ist resource optional; der Token bleibt immer an seine ursprüngliche Resource gebunden. */
function matchesBoundResource(requested: string | null, bound: string): boolean {
  if (requested === null) return true;
  try {
    return canonical(new URL(requested)) === bound;
  } catch {
    return false;
  }
}
