import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  CreateRoleSchema,
  SetAclSchema,
  UpdateRoleSchema,
  type CreateRoleInput,
  type SetAclInput,
  type UpdateRoleInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { AclsService } from "@/modules/acls/acls.service";
import { NotificationService } from "@/modules/websocket/notification.service";

/**
 * Verwaltung der Rechte-Matrix (rollenbasiert) und individueller
 * User-Permissions. Der Zugriff wird über eigene Verwaltungsrechte delegiert.
 */
@ApiTags("ACLs")
@Controller()
@UseGuards(JwtOrApiKeyGuard, AclGuard)
@ApiBearerAuth()
export class AclsController {
  constructor(
    private readonly aclsService: AclsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Alle Rechte nach Rolle gruppiert plus Matrix-Achsen. */
  @Get("acls")
  @RequirePermission("roles", "read")
  @ApiOperation({ summary: "Rechte aller Rollen (Matrix) laden – Admin" })
  @ApiResponse({ status: 200, description: "Rechte-Übersicht." })
  async overview() {
    const data = await this.aclsService.getOverview();
    return { success: true, data };
  }

  /** Zusätzliche Rolle ohne anfängliche Rechte anlegen. */
  @Post("roles")
  @RequirePermission("roles", "create")
  @ApiOperation({ summary: "Zusätzliche Rolle anlegen" })
  async createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateRoleSchema)) input: CreateRoleInput,
  ) {
    const data = await this.aclsService.createRole(input);
    await this.audit.log(user.id, "role.created", "role", data.id, {
      name: data.name,
      description: data.description,
    }, ip);
    this.notifications.notifyPermissionsUpdated();
    return { success: true, data };
  }

  /** Metadaten einer Rolle bearbeiten. */
  @Patch("roles/:roleId")
  @RequirePermission("roles", "update")
  @ApiOperation({ summary: "Rolle bearbeiten" })
  async updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("roleId") roleId: string,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) input: UpdateRoleInput,
  ) {
    const data = await this.aclsService.updateRole(roleId, input);
    await this.audit.log(user.id, "role.updated", "role", roleId, {
      name: data.name,
      description: data.description,
    }, ip);
    this.notifications.notifyPermissionsUpdated();
    return { success: true, data };
  }

  /** Unbenutzte, zusätzliche Rolle löschen. */
  @Delete("roles/:roleId")
  @RequirePermission("roles", "delete")
  @ApiOperation({ summary: "Zusätzliche Rolle löschen" })
  async deleteRole(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("roleId") roleId: string,
  ) {
    const data = await this.aclsService.deleteRole(roleId);
    await this.audit.log(user.id, "role.deleted", "role", roleId, {
      name: data.name,
    }, ip);
    this.notifications.notifyPermissionsUpdated();
    return { success: true, data };
  }

  /** Rechte einer Rolle komplett setzen. */
  @Put("acls/role/:roleId")
  @RequirePermission("roles", "update")
  @ApiOperation({ summary: "Rechte einer Rolle setzen – Admin" })
  @ApiParam({ name: "roleId", description: "UUID der Rolle" })
  @ApiResponse({ status: 200, description: "Rechte wurden gesetzt." })
  @ApiResponse({ status: 404, description: "Rolle nicht gefunden." })
  async setRole(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("roleId") roleId: string,
    @Body(new ZodValidationPipe(SetAclSchema)) entries: SetAclInput,
  ) {
    const data = await this.aclsService.setRoleAcls(roleId, entries, user.id);
    await this.audit.log(
      user.id,
      "acl.updated",
      "acl",
      roleId,
      { entryCount: entries.length },
      ip,
    );
    this.notifications.notifyPermissionsUpdated();
    return { success: true, data };
  }

  /** Individuelle Permissions eines Users lesen. */
  @Get("users/:id/permissions")
  @RequirePermission("user_permissions", "read")
  @ApiOperation({ summary: "Individuelle Permissions eines Users – Admin" })
  @ApiParam({ name: "id", description: "UUID des Users" })
  @ApiResponse({ status: 200, description: "Individuelle Permissions." })
  async getUserPermissions(@Param("id") id: string) {
    const data = await this.aclsService.getUserPermissions(id);
    return { success: true, data };
  }

  /** Individuelle Permissions eines Users setzen. */
  @Put("users/:id/permissions")
  @RequirePermission("user_permissions", "update")
  @ApiOperation({ summary: "Individuelle Permissions eines Users setzen – Admin" })
  @ApiParam({ name: "id", description: "UUID des Users" })
  @ApiResponse({ status: 200, description: "Permissions wurden gesetzt." })
  @ApiResponse({ status: 404, description: "Benutzer nicht gefunden." })
  async setUserPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetAclSchema)) entries: SetAclInput,
  ) {
    const data = await this.aclsService.setUserPermissions(id, entries, user.id);
    await this.audit.log(
      user.id,
      "permission.updated",
      "permission",
      id,
      { entryCount: entries.length },
      ip,
    );
    this.notifications.notifyPermissionsUpdated();
    return { success: true, data };
  }
}
