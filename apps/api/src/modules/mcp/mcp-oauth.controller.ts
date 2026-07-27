import {
  Body, Controller, Get, Header, HttpCode, Ip, Param, Post, Query, Redirect,
  Res, UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { McpOAuthService, OAuthRequestError } from "@/modules/mcp/mcp-oauth.service";

@Controller(".well-known")
export class McpOAuthMetadataController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Get(["oauth-protected-resource", "oauth-protected-resource/mcp"])
  @Header("Cache-Control", "public, max-age=300")
  protectedResource() {
    return this.oauth.protectedResourceMetadata();
  }

  @Get("oauth-authorization-server")
  @Header("Cache-Control", "public, max-age=300")
  authorizationServer() {
    return this.oauth.authorizationServerMetadata();
  }
}

@Controller("oauth")
export class McpOAuthPublicController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Post("register")
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async register(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    await this.respond(res, () => this.oauth.registerClient(body), 201);
  }

  @Get("authorize")
  @Redirect()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async authorize(@Query() query: Record<string, unknown>, @Res() res: Response): Promise<void> {
    try {
      res.redirect(302, await this.oauth.startAuthorization(query));
    } catch (error) {
      this.oauthError(res, error);
    }
  }

  @Post("token")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async token(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    await this.respond(res, () => this.oauth.exchange(body));
  }

  @Post("revoke")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async revoke(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    await this.respond(res, async () => {
      await this.oauth.revoke(body);
      return {};
    });
  }

  private async respond(res: Response, operation: () => Promise<unknown>, status = 200): Promise<void> {
    try {
      res.status(status).json(await operation());
    } catch (error) {
      this.oauthError(res, error);
    }
  }

  private oauthError(res: Response, error: unknown): void {
    const oauth = error instanceof OAuthRequestError
      ? error
      : new OAuthRequestError("server_error", "Die OAuth-Anfrage konnte nicht verarbeitet werden.", 500);
    res.status(oauth.status).json({ error: oauth.code, error_description: oauth.message });
  }
}

@Controller("mcp/oauth")
@UseGuards(JwtAuthGuard, AclGuard)
export class McpOAuthApprovalController {
  constructor(private readonly oauth: McpOAuthService) {}

  @Get("requests/:id")
  @RequirePermission("mcp", "create")
  request(@Param("id") id: string) {
    return this.oauth.authorizationRequest(id).then((data) => ({ success: true, data }));
  }

  @Post("requests/:id/approve")
  @HttpCode(200)
  @RequirePermission("mcp", "create")
  async approve(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    return { success: true, data: { redirectUrl: await this.oauth.approve(id, user.id, ip) } };
  }

  @Post("requests/:id/deny")
  @HttpCode(200)
  @RequirePermission("mcp", "create")
  async deny(@Param("id") id: string) {
    return { success: true, data: { redirectUrl: await this.oauth.deny(id) } };
  }
}
