const DEFAULT_RESOURCE_URL = "http://localhost:4000/mcp";

export const MCP_OAUTH_SCOPES = ["mcp:read", "mcp:write"] as const;

export interface McpProductionConfig {
  resourceUrl: URL;
  issuerUrl: URL;
  webUrl: URL;
  allowedHosts: string[];
  allowedOriginHostnames: string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authorizationRequestTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  readRateLimit: number;
  writeRateLimit: number;
  rateLimitWindowMs: number;
}

/** Central production configuration; public URLs never come from request headers. */
export function getMcpProductionConfig(): McpProductionConfig {
  const production = process.env.NODE_ENV === "production";
  const rawResourceUrl = process.env.MCP_PUBLIC_URL?.trim() || DEFAULT_RESOURCE_URL;
  const resourceUrl = parseAbsoluteUrl(rawResourceUrl, "MCP_PUBLIC_URL");
  if (production && resourceUrl.protocol !== "https:") {
    throw new Error("MCP_PUBLIC_URL muss in Produktion HTTPS verwenden.");
  }
  if (resourceUrl.hash || resourceUrl.search) {
    throw new Error("MCP_PUBLIC_URL darf weder Query-Parameter noch Fragment enthalten.");
  }

  const issuerUrl = new URL(resourceUrl.origin);
  const webUrl = parseAbsoluteUrl(process.env.WEB_URL?.trim() || "http://localhost:3000", "WEB_URL");
  const configuredHosts = csv(process.env.MCP_ALLOWED_HOSTS);
  const configuredOrigins = csv(process.env.MCP_ALLOWED_ORIGINS).map(originHostname);
  const allowedHosts = unique(configuredHosts.length > 0
    ? configuredHosts.map(normalizeHostname)
    : [resourceUrl.hostname, ...(production ? [] : ["localhost", "127.0.0.1", "[::1]"])]);
  const allowedOriginHostnames = unique(configuredOrigins.length > 0
    ? configuredOrigins
    : [webUrl.hostname, ...(production ? [] : ["localhost", "127.0.0.1", "[::1]"])]);

  if (production && (!process.env.MCP_ALLOWED_HOSTS?.trim() || !process.env.MCP_ALLOWED_ORIGINS?.trim())) {
    throw new Error("MCP_ALLOWED_HOSTS und MCP_ALLOWED_ORIGINS sind in Produktion erforderlich.");
  }

  return {
    resourceUrl,
    issuerUrl,
    webUrl,
    allowedHosts,
    allowedOriginHostnames,
    accessTokenTtlSeconds: positiveInt("MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS", 900),
    refreshTokenTtlSeconds: positiveInt("MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS", 30 * 24 * 60 * 60),
    authorizationRequestTtlSeconds: positiveInt("MCP_OAUTH_REQUEST_TTL_SECONDS", 600),
    authorizationCodeTtlSeconds: positiveInt("MCP_OAUTH_CODE_TTL_SECONDS", 300),
    readRateLimit: positiveInt("MCP_RATE_LIMIT_READ", 120),
    writeRateLimit: positiveInt("MCP_RATE_LIMIT_WRITE", 30),
    rateLimitWindowMs: positiveInt("MCP_RATE_LIMIT_WINDOW_MS", 60_000),
  };
}

function parseAbsoluteUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} muss eine absolute URL sein.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} muss eine HTTP(S)-URL ohne Zugangsdaten sein.`);
  }
  return url;
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function originHostname(value: string): string {
  if (!value.includes("://")) return normalizeHostname(value);
  return normalizeHostname(parseAbsoluteUrl(value, "MCP_ALLOWED_ORIGINS").hostname);
}

function normalizeHostname(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.includes("/") || trimmed.includes(":") && !/^\[[0-9a-f:]+\]$/i.test(trimmed)) {
    throw new Error(`Ungültiger Hostname in der MCP-Allowlist: ${value}`);
  }
  return trimmed;
}

function positiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeHostname))];
}
