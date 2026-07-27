import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CreateMcpAccessTokenSchema,
  type CreateMcpAccessTokenInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { AuditService } from "@/modules/audit/audit.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { McpTokenService } from "@/modules/mcp/mcp-token.service";

@ApiTags("MCP tokens")
@ApiBearerAuth()
@Controller("mcp-tokens")
@UseGuards(JwtAuthGuard, AclGuard)
export class McpTokenController {
  constructor(
    private readonly tokens: McpTokenService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission("mcp", "read")
  @ApiOperation({ summary: "Eigene MCP-Tokens auflisten" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.tokens.list(user.id) };
  }

  @Post()
  @RequirePermission("mcp", "create")
  @ApiOperation({ summary: "Neues MCP-Token erstellen" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateMcpAccessTokenSchema)) input: CreateMcpAccessTokenInput,
  ) {
    const data = await this.tokens.create(user.id, input);
    await this.audit.log(
      user.id,
      "mcp_token.created",
      "mcp_token",
      data.id,
      { name: data.name, expiresAt: data.expiresAt },
      ip,
    );
    return { success: true, data };
  }

  @Delete(":id")
  @RequirePermission("mcp", "delete")
  @ApiOperation({ summary: "Eigenes MCP-Token widerrufen" })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.tokens.revoke(user.id, id);
    await this.audit.log(
      user.id,
      "mcp_token.revoked",
      "mcp_token",
      data.id,
      { name: data.name },
      ip,
    );
    return { success: true, data };
  }
}
