import { Injectable, Logger, Optional, type OnModuleDestroy } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  createMcpHandler,
  McpServer,
  getOAuthProtectedResourceMetadataUrl,
  validateHostHeader,
  validateOriginHeader,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { toNodeHandler, type NodeMcpRequestHandler } from "@modelcontextprotocol/node";
import { AuditService } from "@/modules/audit/audit.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import {
  KnowledgeAccessService,
  type KnowledgeAccessContext,
} from "@/modules/knowledge/knowledge-access.service";
import { KnowledgeWriteService } from "@/modules/knowledge/knowledge-write.service";
import { KnowledgeIntelligenceService } from "@/modules/knowledge/knowledge-intelligence.service";
import { StandardsEvaluationService } from "@/modules/knowledge/standards-evaluation.service";
import { McpTokenService } from "@/modules/mcp/mcp-token.service";
import { registerKnowledgeResources } from "@/modules/mcp/resources/knowledge.resources";
import { registerKnowledgeTools } from "@/modules/mcp/tools/knowledge.tools";
import { registerNotesTools } from "@/modules/mcp/tools/notes.tools";
import { registerStandardsTools } from "@/modules/mcp/tools/standards.tools";
import { registerWikiTools } from "@/modules/mcp/tools/wiki.tools";
import { registerNotesWriteTools } from "@/modules/mcp/tools/notes-write.tools";
import { registerStandardsWriteTools } from "@/modules/mcp/tools/standards-write.tools";
import { registerWikiWriteTools } from "@/modules/mcp/tools/wiki-write.tools";
import { registerQualityTools } from "@/modules/mcp/tools/quality.tools";
import { getMcpProductionConfig } from "@/modules/mcp/mcp-production.config";
import { McpRateLimitService } from "@/modules/mcp/mcp-rate-limit.service";
import { MonitoringService } from "@/health/monitoring.service";

type AuthenticatedMcpRequest = Request & { auth?: AuthInfo };

/** MCP-Protokolleinstieg mit benutzergebundener Registrierung der Wissens-Tools. */
@Injectable()
export class McpServerService implements OnModuleDestroy {
  private readonly logger = new Logger(McpServerService.name);
  private readonly handler: McpHttpHandler;
  private readonly nodeHandler: NodeMcpRequestHandler;

  constructor(
    private readonly tokens: McpTokenService,
    private readonly audit: AuditService,
    private readonly knowledge: KnowledgeAccessService,
    private readonly knowledgeWrite: KnowledgeWriteService,
    private readonly evaluation: StandardsEvaluationService,
    private readonly intelligence: KnowledgeIntelligenceService,
    private readonly rateLimits: McpRateLimitService = {
      consume: async () => ({ allowed: true, limit: 1_000_000, remaining: 999_999, retryAfterSeconds: 1 }),
    } as unknown as McpRateLimitService,
    @Optional() private readonly monitoring?: MonitoringService,
  ) {
    // Validate all public URLs and allowlists at startup, not on the first request.
    getMcpProductionConfig();
    this.handler = createMcpHandler((context) => this.createServer(context.authInfo), {
      legacy: "stateless",
      responseMode: "json",
      onerror: (error) => this.logger.error(`MCP-Protokollfehler: ${error.message}`),
    });
    this.nodeHandler = toNodeHandler(this.handler, {
      onerror: (error) => this.logger.error(`MCP-Transportfehler: ${error.message}`),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.handler.close();
  }

  async handle(req: AuthenticatedMcpRequest, res: Response): Promise<void> {
    const config = getMcpProductionConfig();
    if (!this.validateRequestOrigin(req, res, config.allowedHosts, config.allowedOriginHostnames)) return;
    this.securityHeaders(res);
    const rawToken = this.bearerToken(req.headers.authorization);
    const access = rawToken ? await this.tokens.verify(rawToken, config.resourceUrl.href) : null;
    if (!rawToken || !access) {
      this.monitoring?.recordMcpAuthentication(false);
      this.monitoring?.recordMcpRequest("auth_failure");
      this.monitoring?.recordSecurityHttpResponse(401);
      const metadataUrl = getOAuthProtectedResourceMetadataUrl(config.resourceUrl);
      res.setHeader("WWW-Authenticate", `Bearer realm="AD-Wiki MCP", resource_metadata="${metadataUrl}", scope="mcp:read mcp:write"`);
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    this.monitoring?.recordMcpAuthentication(true);

    req.auth = {
      token: rawToken,
      clientId: access.clientId ?? access.user.id,
      scopes: access.scopes,
      expiresAt: access.expiresAt
        ? Math.floor(access.expiresAt.getTime() / 1000)
        : undefined,
      extra: {
        tokenId: access.tokenId,
        userId: access.user.id,
        role: access.user.role,
      },
    };
    Object.defineProperty(req.auth.extra, "actor", {
      value: access.user,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    const protocolMethod = this.protocolMethod(req.body as unknown);
    const toolName = this.toolName(req.body as unknown);
    const requestId = this.requestId(req);
    const startedAt = Date.now();
    let transportStatus: "handled" | "rate_limited" | "transport_error" = "handled";

    const rateKind = toolName && WRITE_TOOLS.has(toolName) ? "write" : "read";
    try {
      const rate = await this.rateLimits.consume(access.tokenId, rateKind);
      res.setHeader("RateLimit-Limit", String(rate.limit));
      res.setHeader("RateLimit-Remaining", String(rate.remaining));
      if (!rate.allowed) {
        transportStatus = "rate_limited";
        this.monitoring?.recordSecurityHttpResponse(429);
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        res.status(429).json({
          jsonrpc: "2.0",
          error: { code: -32029, message: "Too many requests" },
          id: null,
        });
        return;
      }

      await this.nodeHandler(req, res, req.body);
    } catch (error) {
      transportStatus = "transport_error";
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP-Request fehlgeschlagen: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    } finally {
      this.monitoring?.recordMcpRequest(
        transportStatus === "handled" ? "success" : transportStatus,
      );
      await this.audit.log(
        access.user.id,
        toolName ? "mcp.tool_called" : "mcp.request",
        "mcp",
        null,
        {
          requestId,
          tokenId: access.tokenId,
          protocolMethod,
          ...(toolName ? { toolName } : {}),
          transportStatus,
          durationMs: Date.now() - startedAt,
        },
        req.ip,
      );
    }
  }

  private validateRequestOrigin(req: Request, res: Response, allowedHosts: string[], allowedOrigins: string[]): boolean {
    const host = validateHostHeader(req.headers.host, allowedHosts);
    if (!host.ok) {
      this.monitoring?.recordMcpRequest("forbidden");
      this.monitoring?.recordSecurityHttpResponse(403);
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32003, message: "Forbidden host" }, id: null });
      return false;
    }
    const originHeader = req.headers.origin;
    const origin = validateOriginHeader(Array.isArray(originHeader) ? originHeader[0] : originHeader, allowedOrigins);
    if (!origin.ok) {
      this.monitoring?.recordMcpRequest("forbidden");
      this.monitoring?.recordSecurityHttpResponse(403);
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32003, message: "Forbidden origin" }, id: null });
      return false;
    }
    return true;
  }

  private securityHeaders(res: Response): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
  }

  private createServer(authInfo?: AuthInfo): McpServer {
    const server = new McpServer(
      { name: "ad-wiki", version: "0.1.0" },
      { capabilities: { tools: {}, resources: {} } },
    );
    const context = this.knowledgeContext(authInfo);
    if (context) {
      registerKnowledgeTools(server, this.knowledge, context);
      registerWikiTools(server, this.knowledge, context);
      registerNotesTools(server, this.knowledge, context);
      registerStandardsTools(server, this.knowledge, context);
      registerWikiWriteTools(server, this.knowledgeWrite, context);
      registerNotesWriteTools(server, this.knowledgeWrite, context);
      registerStandardsWriteTools(server, this.knowledgeWrite, context);
      registerQualityTools(server, this.evaluation, this.intelligence, context);
      registerKnowledgeResources(server, this.knowledge, context);
    }
    return server;
  }

  private bearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1]?.trim() || null;
  }

  /** Liest nur den Toolnamen; Tool-Eingaben werden bewusst nicht auditiert. */
  private toolName(body: unknown): string | null {
    if (!isRecord(body) || body.method !== "tools/call" || !isRecord(body.params)) {
      return null;
    }
    return typeof body.params.name === "string" && body.params.name.length > 0
      ? body.params.name
      : null;
  }

  /** Erfasst nur den JSON-RPC-Methodennamen; Parameter und Ressourcen-URIs bleiben vertraulich. */
  private protocolMethod(body: unknown): string {
    if (!isRecord(body) || typeof body.method !== "string") return "unknown";
    const method = body.method.trim();
    return method.length > 0 && method.length <= 200 ? method : "unknown";
  }

  private requestId(req: Request): string {
    const header = req.headers["x-request-id"];
    return typeof header === "string" && header.length > 0 && header.length <= 200
      ? header
      : randomUUID();
  }

  private knowledgeContext(authInfo: AuthInfo | undefined): KnowledgeAccessContext | null {
    const userId = authInfo?.extra?.userId;
    const tokenId = authInfo?.extra?.tokenId;
    const actor = authInfo?.extra?.actor;
    if (typeof userId !== "string") return null;
    return Object.freeze({
      userId,
      scopes: Object.freeze([...(authInfo?.scopes ?? [])]),
      tokenId: typeof tokenId === "string" ? tokenId : undefined,
      actor:
        actor && typeof actor === "object"
          ? (actor as AuthenticatedUser)
          : undefined,
    });
  }
}

const WRITE_TOOLS = new Set([
  "create_page",
  "update_page",
  "create_note",
  "update_note",
  "create_standard_draft",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
