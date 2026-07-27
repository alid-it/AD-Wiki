import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type {
  CreateMcpAccessTokenInput,
  CreatedMcpAccessToken,
  McpAccessToken,
} from "@ad-wiki/shared-types";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuthService } from "@/modules/auth/auth.service";
import { PrismaService } from "@/prisma/prisma.service";

const TOKEN_PREFIX = "ad_wiki_mcp_";
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export interface VerifiedMcpAccess {
  tokenId: string;
  clientId?: string;
  user: AuthenticatedUser;
  scopes: string[];
  expiresAt: Date | null;
}

/** Verwaltet benutzergebundene MCP-Tokens. Der Klartext wird nie persistiert. */
@Injectable()
export class McpTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async list(userId: string): Promise<McpAccessToken[]> {
    const rows = await this.prisma.mcpAccessToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.toApi(row));
  }

  async create(
    userId: string,
    input: CreateMcpAccessTokenInput,
  ): Promise<CreatedMcpAccessToken> {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Das Ablaufdatum muss in der Zukunft liegen.");
    }

    const secret = randomBytes(32).toString("base64url");
    const token = `${TOKEN_PREFIX}${secret}`;
    const row = await this.prisma.mcpAccessToken.create({
      data: {
        userId,
        name: input.name,
        tokenHash: this.hash(token),
        tokenPrefix: `${TOKEN_PREFIX}${secret.slice(0, 8)}`,
        expiresAt,
      },
    });
    return { ...this.toApi(row), token };
  }

  /** Issues a short-lived, audience- and scope-bound OAuth access token. */
  async createOAuthAccessToken(input: {
    userId: string;
    clientId: string;
    clientName: string;
    resource: string;
    requestedScopes: string[];
    expiresAt: Date;
  }): Promise<{ token: string; expiresAt: Date }> {
    const secret = randomBytes(32).toString("base64url");
    const token = `${TOKEN_PREFIX}${secret}`;
    await this.prisma.mcpAccessToken.create({
      data: {
        userId: input.userId,
        name: `OAuth: ${input.clientName}`.slice(0, 100),
        tokenHash: this.hash(token),
        tokenPrefix: `${TOKEN_PREFIX}${secret.slice(0, 8)}`,
        oauthClientId: input.clientId,
        resource: input.resource,
        requestedScopes: input.requestedScopes,
        expiresAt: input.expiresAt,
      },
    });
    return { token, expiresAt: input.expiresAt };
  }

  async revoke(userId: string, tokenId: string): Promise<McpAccessToken> {
    const token = await this.prisma.mcpAccessToken.findFirst({
      where: { id: tokenId, userId },
    });
    if (!token) throw new NotFoundException("MCP-Token wurde nicht gefunden.");

    const row = token.revokedAt
      ? token
      : await this.prisma.mcpAccessToken.update({
          where: { id: token.id },
          data: { revokedAt: new Date() },
        });
    return this.toApi(row);
  }

  /**
   * Prueft Tokenstatus, aktiven Benutzer und aktuelle ACLs bei jedem Request.
   * Dadurch greifen Rollen- oder UserPermission-Aenderungen ohne Neuausstellung.
   */
  async verify(rawToken: string, expectedResource?: string): Promise<VerifiedMcpAccess | null> {
    if (!rawToken.startsWith(TOKEN_PREFIX)) return null;

    const row = await this.prisma.mcpAccessToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
      include: { user: { include: { role: true } } },
    });
    if (
      !row ||
      row.revokedAt ||
      (row.expiresAt && row.expiresAt.getTime() <= Date.now()) ||
      !row.user.isActive
    ) {
      return null;
    }
    if (row.resource && expectedResource && canonicalResource(row.resource) !== canonicalResource(expectedResource)) {
      return null;
    }

    const permissions = await this.authService.getEffectivePermissions(row.userId);
    let scopes = permissions
      .filter((entry) => entry.allowed)
      .map((entry) => `${entry.resource}:${entry.action}`);
    if (!scopes.includes("mcp:read")) return null;

    const requestedScopes = row.requestedScopes ?? [];
    if (row.oauthClientId) {
      if (!row.expiresAt || !requestedScopes.includes("mcp:read")) return null;
      const mayWrite = requestedScopes.includes("mcp:write");
      scopes = scopes.filter((scope) => {
        const action = scope.split(":", 2)[1];
        return action === "read" || action === undefined || mayWrite;
      });
    }

    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS) {
      await this.prisma.mcpAccessToken.update({
        where: { id: row.id },
        data: { lastUsedAt: new Date(now) },
      });
    }

    return {
      tokenId: row.id,
      clientId: row.oauthClientId ?? undefined,
      user: {
        id: row.user.id,
        email: row.user.email,
        username: row.user.username,
        displayName: row.user.displayName,
        roleId: row.user.role.id,
        role: row.user.role.name as AuthenticatedUser["role"],
        isActive: row.user.isActive,
        isProtected: row.user.isProtected,
        authenticationMethod: "jwt",
      },
      scopes,
      expiresAt: row.expiresAt,
    };
  }

  private hash(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }

  private toApi(row: {
    id: string;
    name: string;
    tokenPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }): McpAccessToken {
    const active = !row.revokedAt && (!row.expiresAt || row.expiresAt.getTime() > Date.now());
    return {
      id: row.id,
      name: row.name,
      tokenPrefix: row.tokenPrefix,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      active,
    };
  }
}

function canonicalResource(value: string): string {
  const url = new URL(value);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  return url.href.replace(/\/$/, "");
}
