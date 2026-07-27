import { Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateApiKeySchema, type CreateApiKeyInput } from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { ApiKeysService } from "@/modules/api-keys/api-keys.service";
import { AuditService } from "@/modules/audit/audit.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";

@ApiTags("API Keys")
@ApiBearerAuth()
@Controller("api-keys")
export class ApiKeysController {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly audit: AuditService,
  ) {}

  @Get("admin")
  @UseGuards(JwtAuthGuard, AclGuard)
  @RequirePermission("api_keys", "read")
  @ApiOperation({ summary: "Alle API Keys aller Benutzer auflisten" })
  async listAll() {
    return { success: true, data: await this.apiKeys.listAll() };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Eigene API Keys auflisten" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.apiKeys.list(user.id) };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "API Key erstellen und einmalig im Klartext ausgeben" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) input: CreateApiKeyInput,
  ) {
    const data = await this.apiKeys.create(user.id, input);
    await this.audit.log(user.id, "api_key.created", "api_key", data.id, {
      name: data.name,
      expiresAt: data.expiresAt,
    }, ip);
    return { success: true, data };
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  @ApiHeader({ name: "Authorization", required: true })
  @ApiOperation({ summary: "Eigenen API Key deaktivieren" })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.apiKeys.deactivate(user.id, id);
    await this.audit.log(user.id, "api_key.deactivated", "api_key", data.id, {
      name: data.name,
    }, ip);
    return { success: true, data };
  }
}
