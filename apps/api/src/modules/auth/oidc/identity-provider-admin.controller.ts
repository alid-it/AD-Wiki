import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CreateIdentityProviderGroupMappingSchema,
  CreateIdentityProviderRoleMappingSchema,
  CreateIdentityProviderSchema,
  DeleteIdentityProviderSchema,
  UpdateIdentityProviderSchema,
  type CreateIdentityProviderGroupMappingInput,
  type CreateIdentityProviderInput,
  type CreateIdentityProviderRoleMappingInput,
  type DeleteIdentityProviderInput,
  type UpdateIdentityProviderInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { AuditService } from "@/modules/audit/audit.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { IdentityProviderAdminService } from "@/modules/auth/oidc/identity-provider-admin.service";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";

@ApiTags("Identity Providers")
@ApiBearerAuth()
@Controller("identity-providers")
@UseGuards(JwtAuthGuard, AclGuard)
export class IdentityProviderAdminController {
  constructor(
    private readonly providers: IdentityProviderAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission("identity_providers", "read")
  @ApiOperation({ summary: "OIDC-Provider sicher reduziert auflisten" })
  async findAll() {
    return { success: true, data: await this.providers.findAll() };
  }

  @Get("reference-data")
  @RequirePermission("identity_mappings", "read")
  @ApiOperation({ summary: "Zulässige lokale Gruppen und Rollen für Mappings laden" })
  async referenceData() {
    return { success: true, data: await this.providers.referenceData() };
  }

  @Post()
  @RequirePermission("identity_providers", "update")
  @ApiOperation({ summary: "OIDC-Provider anlegen" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateIdentityProviderSchema))
    input: CreateIdentityProviderInput,
  ) {
    const data = await this.providers.create(input);
    await this.audit.log(
      user.id,
      "identity_provider.created",
      "identity_provider",
      data.id,
      { type: data.type, active: data.isActive },
      ip,
    );
    return { success: true, data };
  }

  @Get(":id")
  @RequirePermission("identity_providers", "read")
  @ApiOperation({ summary: "OIDC-Provider mit Mappings laden" })
  async findOne(@Param("id", new ParseUUIDPipe()) id: string) {
    return { success: true, data: await this.providers.findOne(id) };
  }

  @Patch(":id")
  @RequirePermission("identity_providers", "update")
  @ApiOperation({ summary: "OIDC-Provider aktualisieren" })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateIdentityProviderSchema))
    input: UpdateIdentityProviderInput,
  ) {
    const data = await this.providers.update(id, input);
    await this.audit.log(
      user.id,
      "identity_provider.updated",
      "identity_provider",
      id,
      {
        changedFields: Object.keys(input).filter(
          (key) => !["clientSecret", "confirmLastActiveProvider"].includes(key),
        ),
        secretChanged:
          input.clientSecret !== undefined || input.clearClientSecret === true,
        active: data.isActive,
      },
      ip,
    );
    return { success: true, data };
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("identity_providers", "update")
  @ApiOperation({ summary: "OIDC-Provider kontrolliert löschen" })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(DeleteIdentityProviderSchema))
    input: DeleteIdentityProviderInput,
  ) {
    const data = await this.providers.remove(id, input);
    await this.audit.log(
      user.id,
      "identity_provider.deleted",
      "identity_provider",
      id,
      { name: data.name },
      ip,
    );
    return { success: true, data };
  }

  @Post(":id/group-mappings")
  @RequirePermission("identity_mappings", "update")
  @ApiOperation({ summary: "Externes Gruppen-Mapping anlegen" })
  async createGroupMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(CreateIdentityProviderGroupMappingSchema))
    input: CreateIdentityProviderGroupMappingInput,
  ) {
    const data = await this.providers.createGroupMapping(id, input);
    await this.audit.log(
      user.id,
      "identity_mapping.created",
      "identity_provider",
      id,
      { kind: "group", mappingId: data.id, groupId: data.groupId },
      ip,
    );
    return { success: true, data };
  }

  @Delete(":id/group-mappings/:mappingId")
  @HttpCode(200)
  @RequirePermission("identity_mappings", "update")
  async removeGroupMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("mappingId", new ParseUUIDPipe()) mappingId: string,
  ) {
    const data = await this.providers.removeGroupMapping(id, mappingId);
    await this.audit.log(
      user.id,
      "identity_mapping.deleted",
      "identity_provider",
      id,
      { kind: "group", mappingId },
      ip,
    );
    return { success: true, data };
  }

  @Post(":id/role-mappings")
  @RequirePermission("identity_mappings", "update")
  @ApiOperation({ summary: "Externes Rollen-Mapping anlegen" })
  async createRoleMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(CreateIdentityProviderRoleMappingSchema))
    input: CreateIdentityProviderRoleMappingInput,
  ) {
    const data = await this.providers.createRoleMapping(id, input);
    await this.audit.log(
      user.id,
      "identity_mapping.created",
      "identity_provider",
      id,
      { kind: "role", mappingId: data.id, roleId: data.roleId },
      ip,
    );
    return { success: true, data };
  }

  @Delete(":id/role-mappings/:mappingId")
  @HttpCode(200)
  @RequirePermission("identity_mappings", "update")
  async removeRoleMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("mappingId", new ParseUUIDPipe()) mappingId: string,
  ) {
    const data = await this.providers.removeRoleMapping(id, mappingId);
    await this.audit.log(
      user.id,
      "identity_mapping.deleted",
      "identity_provider",
      id,
      { kind: "role", mappingId },
      ip,
    );
    return { success: true, data };
  }

  @Get(":id/synchronization/status")
  @RequirePermission("identity_sync", "read")
  async synchronizationStatus(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return {
      success: true,
      data: await this.providers.synchronizationStatus(id),
    };
  }

  @Get(":id/synchronization/history")
  @RequirePermission("identity_sync", "read")
  async synchronizationHistory(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return {
      success: true,
      data: await this.providers.synchronizationHistory(id),
    };
  }
}
