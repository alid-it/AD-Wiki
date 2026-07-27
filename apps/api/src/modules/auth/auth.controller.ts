import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import {
  ChangePasswordSchema,
  LoginSchema,
  RequestPasswordResetSchema,
  RefreshTokenSchema,
  RegisterSchema,
  ResetPasswordSchema,
  type ChangePasswordInput,
  type RequestPasswordResetInput,
  type ResetPasswordInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { AuthService } from "@/modules/auth/auth.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import type { LoginDto } from "@/modules/auth/dto/login.dto";
import type { RefreshTokenDto } from "@/modules/auth/dto/refresh-token.dto";
import type { RegisterDto } from "@/modules/auth/dto/register.dto";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";

/** REST-Endpunkte für Registrierung, Login und Session-Verwaltung. */
@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly notifications: NotificationService,
  ) {}

  /** Neuen User registrieren (Rolle "viewer") und direkt einloggen. */
  @Post("register")
  // Brute-Force-Schutz: max. 3 Registrierungen pro Minute und IP.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: "Neuen Benutzer registrieren" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "username", "displayName", "password", "confirmPassword"],
      properties: {
        email: { type: "string", example: "max@example.com" },
        username: { type: "string", example: "maxmuster" },
        displayName: { type: "string", example: "Max Mustermann" },
        password: { type: "string", example: "supersicher123" },
        confirmPassword: { type: "string", example: "supersicher123" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Benutzer wurde angelegt und eingeloggt." })
  @ApiResponse({ status: 400, description: "Ungültige Eingabedaten." })
  @ApiResponse({ status: 409, description: "E-Mail oder Benutzername bereits vergeben." })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    const data = await this.authService.register(dto, {
      ipAddress: ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    this.notifications.notifyUserRegistered(data.user);
    return { success: true, data };
  }

  /** Mit E-Mail und Passwort einloggen. */
  @Post("login")
  @HttpCode(200)
  // Brute-Force-Schutz: max. 5 Login-Versuche pro Minute und IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Anmelden und Tokens erhalten" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: { type: "string", example: "admin@ad-wiki.local" },
        password: { type: "string", example: "admin123" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Login erfolgreich, Tokens ausgestellt." })
  @ApiResponse({ status: 401, description: "E-Mail oder Passwort ist falsch." })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    const data = await this.authService.login(dto, {
      ipAddress: ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    return { success: true, data };
  }

  /** Access- und Refresh-Token aus einem gültigen Refresh-Token rotieren. */
  @Post("forgot-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: "Passwort-Reset-Mail anfordern" })
  @ApiResponse({ status: 200, description: "Kontenneutrale Bestätigung." })
  async forgotPassword(
    @Body(new ZodValidationPipe(RequestPasswordResetSchema)) dto: RequestPasswordResetInput,
    @Ip() ip: string,
  ) {
    await this.authService.requestPasswordReset(dto.email, ip);
    return {
      success: true,
      data: { message: "Wenn ein aktives Konto existiert, wurde eine E-Mail versendet." },
    };
  }

  @Post("reset-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Passwort mit Reset-Token neu setzen" })
  @ApiResponse({ status: 200, description: "Passwort wurde geändert." })
  @ApiResponse({ status: 400, description: "Reset-Link ungültig oder abgelaufen." })
  async resetPassword(
    @Body(new ZodValidationPipe(ResetPasswordSchema)) dto: ResetPasswordInput,
    @Ip() ip: string,
  ) {
    await this.authService.resetPassword(dto.token, dto.newPassword, ip);
    return { success: true, data: { message: "Passwort wurde geändert." } };
  }

  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({ summary: "Token-Paar erneuern und Refresh-Token rotieren" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["refreshToken"],
      properties: { refreshToken: { type: "string" } },
    },
  })
  @ApiResponse({ status: 200, description: "Neues Access- und Refresh-Token." })
  @ApiResponse({ status: 401, description: "Refresh-Token ungültig oder abgelaufen." })
  async refresh(
    @Body(new ZodValidationPipe(RefreshTokenSchema)) dto: RefreshTokenDto,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    const data = await this.authService.refreshToken(dto.refreshToken, {
      ipAddress: ip,
      userAgent: req.get("user-agent") ?? undefined,
    });
    return { success: true, data };
  }

  /** Session beenden (Refresh-Token verwerfen). */
  @Post("logout")
  @HttpCode(200)
  @ApiOperation({ summary: "Abmelden und Session löschen" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["refreshToken"],
      properties: { refreshToken: { type: "string" } },
    },
  })
  @ApiResponse({ status: 200, description: "Erfolgreich abgemeldet." })
  async logout(
    @Body(new ZodValidationPipe(RefreshTokenSchema)) dto: RefreshTokenDto,
    @Ip() ip: string,
  ) {
    await this.authService.logout(dto.refreshToken, ip);
    return { success: true, data: { message: "Erfolgreich abgemeldet" } };
  }

  /** Passwort des eingeloggten Users ändern (geschützt). */
  @Post("change-password")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Eigenes Passwort ändern" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["currentPassword", "newPassword", "confirmPassword"],
      properties: {
        currentPassword: { type: "string" },
        newPassword: { type: "string" },
        confirmPassword: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Passwort wurde geändert." })
  @ApiResponse({ status: 401, description: "Aktuelles Passwort falsch oder nicht angemeldet." })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordInput,
  ) {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { success: true, data: { message: "Passwort geändert" } };
  }

  /** Aktuell eingeloggten User zurückgeben (geschützt). */
  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Aktuellen Benutzer abrufen" })
  @ApiResponse({ status: 200, description: "Der authentifizierte Benutzer." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: user };
  }

  @Get("permissions")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async permissions(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.authService.getEffectivePermissions(user.id) };
  }
}
