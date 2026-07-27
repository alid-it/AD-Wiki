import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  UpdateSettingSchema,
  UpdateSmtpConfigurationSchema,
  type UpdateSettingInput,
  type UpdateSmtpConfigurationInput,
  type SystemInfo,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { SettingsService } from "@/modules/settings/settings.service";
import { SmtpService } from "@/modules/settings/smtp.service";
import { MonitoringService } from "@/health/monitoring.service";

/** REST-Endpunkte für die plattformweiten Einstellungen (Admin). */
@ApiTags("Settings")
@Controller("settings")
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly smtpService: SmtpService,
    private readonly audit: AuditService,
    private readonly monitoring: MonitoringService,
  ) {}

  /** Öffentliches Branding für Navbar und Seitentitel. */
  @Get("branding")
  @ApiOperation({ summary: "Öffentliches Plattform-Branding lesen" })
  @ApiResponse({ status: 200, description: "Öffentlich sichtbare Branding-Einstellungen." })
  async branding() {
    const data = await this.settingsService.getBranding();
    return { success: true, data };
  }

  /** Strukturierter Betriebszustand für die geschützte Admin-Oberfläche. */
  @Get("system-info")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @ApiBearerAuth()
  @RequirePermission("system_info", "read")
  @ApiOperation({ summary: "Systemstatus und Monitoring-Hinweise lesen" })
  async systemInfo(): Promise<{ success: true; data: SystemInfo }> {
    return { success: true, data: await this.monitoring.systemInfo() };
  }

  /** Alle Settings auflisten (Admin). */
  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @ApiBearerAuth()
  @RequirePermission("settings", "read")
  @ApiOperation({ summary: "Alle Einstellungen auflisten (Admin)" })
  @ApiResponse({ status: 200, description: "Liste aller Settings." })
  async findAll() {
    const data = await this.settingsService.findAll();
    return { success: true, data };
  }

  /** SMTP-Konfiguration ohne geheimes Passwort lesen. */
  @Get("smtp")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @ApiBearerAuth()
  @RequirePermission("smtp", "read")
  @ApiOperation({ summary: "SMTP-Konfiguration lesen" })
  async smtpConfiguration() {
    return { success: true, data: await this.smtpService.configuration() };
  }

  /** SMTP-Konfiguration speichern; ein fehlendes Passwort behält das bestehende Secret. */
  @Patch("smtp")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @ApiBearerAuth()
  @RequirePermission("smtp", "update")
  @ApiOperation({ summary: "SMTP-Konfiguration aktualisieren" })
  async updateSmtp(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(UpdateSmtpConfigurationSchema)) dto: UpdateSmtpConfigurationInput,
  ) {
    const data = await this.smtpService.update(dto);
    await this.audit.log(user.id, "smtp.updated", "setting", "smtp", {
      host: data.host,
      port: data.port,
      security: data.security,
      usernameConfigured: data.username !== null,
      passwordConfigured: data.hasPassword,
      fromEmail: data.fromEmail,
      isEnabled: data.isEnabled,
    }, ip);
    return { success: true, data };
  }

  /** Verbindung prüfen und eine echte Testmail an den angemeldeten Admin senden. */
  @Post("smtp/test")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @ApiBearerAuth()
  @RequirePermission("smtp", "test")
  @ApiOperation({ summary: "SMTP-Verbindung und Mailversand testen" })
  async testSmtp(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    const data = await this.smtpService.test(user.email);
    await this.audit.log(user.id, "smtp.tested", "setting", "smtp", {
      recipient: user.email,
      sentAt: data.sentAt,
    }, ip);
    return { success: true, data };
  }

  /** Ein Setting ändern (Admin). */
  @Patch(":key")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @ApiBearerAuth()
  @RequirePermission("settings", "update")
  @ApiOperation({ summary: "Einstellung ändern (Admin)" })
  @ApiParam({ name: "key", description: "Schlüssel des Settings" })
  @ApiBody({
    schema: { type: "object", required: ["value"], properties: { value: { type: "string" } } },
  })
  @ApiResponse({ status: 200, description: "Setting wurde geändert." })
  @ApiResponse({ status: 404, description: "Setting nicht gefunden." })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(UpdateSettingSchema)) dto: UpdateSettingInput,
  ) {
    const data = await this.settingsService.update(key, dto);
    await this.audit.log(
      user.id,
      "setting.updated",
      "setting",
      key,
      { key, value: data.value },
      ip,
    );
    return { success: true, data };
  }
}
