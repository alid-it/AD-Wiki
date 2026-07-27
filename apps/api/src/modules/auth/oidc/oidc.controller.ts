import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  ExchangeOidcLoginCodeSchema,
  type ExchangeOidcLoginCodeInput,
  IdentitySyncPreviewInputSchema,
  type IdentitySyncPreviewInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { IdentitySynchronizationService } from "@/modules/auth/oidc/identity-synchronization.service";
import { IdentityProviderOperationService } from "@/modules/auth/oidc/identity-provider-operation.service";
import {
  OidcLoginError,
  OidcService,
  oidcBindingCookieName,
  oidcCallbackUrl,
  oidcWebLoginUrl,
  oidcWebProfileUrl,
} from "@/modules/auth/oidc/oidc.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";

const OIDC_COOKIE_PATH = "/api/v1/auth/oidc";

/** Öffentliche Einstiegspunkte des providerneutralen OIDC-Code-Flows. */
@ApiTags("Auth")
@Controller("auth/oidc")
export class OidcController {
  private readonly logger = new Logger(OidcController.name);

  constructor(
    private readonly oidc: OidcService,
    private readonly identitySync: IdentitySynchronizationService,
    private readonly providerOperations: IdentityProviderOperationService,
    private readonly audit: AuditService,
  ) {}

  @Get("providers")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Aktive SSO-Anbieter für die Loginseite abrufen" })
  async providers() {
    return { success: true, data: await this.oidc.getLoginProviders() };
  }

  @Get("identities")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Eigene verknüpfte SSO-Identitäten abrufen" })
  async identities(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.oidc.getLinkedIdentities(user.id),
    };
  }

  @Post(":providerSlug/link/start")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Erneut authentifizieren und SSO-Konto verknüpfen" })
  async startLink(
    @Param("providerSlug") providerSlug: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const login = await this.oidc.startLink(providerSlug, user.id);
    setBindingCookie(response, login);
    return {
      success: true,
      data: { authorizationUrl: login.authorizationUrl },
    };
  }

  @Post("identities/:identityId/unlink/start")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "SSO-Identität nach erneuter Anmeldung entfernen" })
  async startUnlink(
    @Param("identityId") identityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const login = await this.oidc.startUnlink(identityId, user.id);
    setBindingCookie(response, login);
    return {
      success: true,
      data: { authorizationUrl: login.authorizationUrl },
    };
  }

  @Post("providers/:providerId/sync/preview")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AclGuard)
  @RequirePermission("identity_sync", "update")
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Gruppen- und Rollenabgleich ohne Änderungen vorab anzeigen",
  })
  async previewSynchronization(
    @Param("providerId") providerId: string,
    @Body(new ZodValidationPipe(IdentitySyncPreviewInputSchema))
    input: IdentitySyncPreviewInput,
  ) {
    return {
      success: true,
      data: await this.identitySync.preview(
        providerId,
        input.externalIdentityId,
        input.claims,
      ),
    };
  }

  @Post("providers/:providerId/test-connection")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AclGuard)
  @RequirePermission("identity_providers", "update")
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: "Öffentliche OIDC-Metadaten und Logout-Fähigkeiten prüfen",
  })
  async testProviderConnection(
    @Param("providerId") providerId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
  ) {
    const data = await this.providerOperations.testConnection(providerId);
    await this.audit.log(
      user.id,
      "identity_provider.connection_tested",
      "identity_provider",
      providerId,
      { successful: data.ok, durationMs: data.durationMs },
      ipAddress,
    );
    return {
      success: true,
      data,
    };
  }

  @Get(":providerSlug/start")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "OIDC-Anmeldung mit PKCE starten" })
  @ApiResponse({ status: 302, description: "Weiterleitung zum Identity Provider." })
  async start(
    @Param("providerSlug") providerSlug: string,
    @Res() response: Response,
  ): Promise<void> {
    const login = await this.oidc.startLogin(providerSlug);
    response.setHeader("Cache-Control", "no-store");
    setBindingCookie(response, login);
    response.redirect(302, login.authorizationUrl);
  }

  @Get(":providerSlug/callback")
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ApiOperation({ summary: "OIDC-Callback sicher abschließen" })
  async callback(
    @Param("providerSlug") providerSlug: string,
    @Req() request: Request,
    @Res() response: Response,
    @Ip() ipAddress: string,
  ): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");

    const currentUrl = callbackRequestUrl(providerSlug, request.originalUrl);
    const state = currentUrl.searchParams.get("state") ?? "";
    const cookieName = oidcBindingCookieName(state);
    const browserBinding = readCookie(request.headers.cookie, cookieName);
    response.clearCookie(cookieName, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: OIDC_COOKIE_PATH,
    });

    try {
      const completion = await this.oidc.completeLogin(
        providerSlug,
        currentUrl,
        browserBinding,
        {
          ipAddress,
          userAgent: request.get("user-agent") ?? undefined,
        },
      );
      response.redirect(
        302,
        completion.kind === "login"
          ? oidcWebLoginUrl("oidc_code", completion.loginCode)
          : oidcWebProfileUrl("oidc_link", completion.result),
      );
    } catch (error) {
      const code =
        error instanceof OidcLoginError
          ? error.code
          : "provider_unavailable";
      this.logger.warn(
        `OIDC-Anmeldung abgewiesen (${providerSlug}): ${safeErrorName(error)}`,
      );
      response.redirect(
        302,
        error instanceof OidcLoginError && error.accountAction
          ? oidcWebProfileUrl("oidc_error", code)
          : oidcWebLoginUrl("oidc_error", code),
      );
    }
  }

  @Post("exchange")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "OIDC-Einmalcode gegen interne Sitzung tauschen" })
  async exchange(
    @Body(new ZodValidationPipe(ExchangeOidcLoginCodeSchema))
    input: ExchangeOidcLoginCodeInput,
    @Req() request: Request,
    @Ip() ipAddress: string,
  ) {
    const data = await this.oidc.exchangeLoginCode(input.code, {
      ipAddress,
      userAgent: request.get("user-agent") ?? undefined,
    });
    return { success: true, data };
  }
}

function setBindingCookie(
  response: Response,
  login: {
    bindingCookieName: string;
    browserBinding: string;
  },
): void {
  response.cookie(login.bindingCookieName, login.browserBinding, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: OIDC_COOKIE_PATH,
    maxAge: 10 * 60 * 1000,
  });
}

function callbackRequestUrl(
  providerSlug: string,
  originalUrl: string,
): URL {
  const callback = new URL(oidcCallbackUrl(providerSlug));
  const queryIndex = originalUrl.indexOf("?");
  if (queryIndex >= 0) {
    callback.search = originalUrl.slice(queryIndex);
  }
  return callback;
}

function readCookie(
  cookieHeader: string | undefined,
  expectedName: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    if (name !== expectedName) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
