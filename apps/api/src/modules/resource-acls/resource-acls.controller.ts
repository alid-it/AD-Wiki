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
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ActionSchema,
  CreateResourceAclEntrySchema,
  EvaluateResourceAccessSchema,
  ResourceAclListQuerySchema,
  ResourceAclTargetTypeSchema,
  SetResourceAclBoundarySchema,
  UpdateResourceAclEntrySchema,
  type Action,
  type CreateResourceAclEntryInput,
  type EvaluateResourceAccessInput,
  type ResourceAclListQuery,
  type ResourceAclTargetType,
  type SetResourceAclBoundaryInput,
  type UpdateResourceAclEntryInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AuditService } from "@/modules/audit/audit.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { ResourceAccessService } from "@/modules/resource-acls/resource-access.service";
import { ResourceAclService } from "@/modules/resource-acls/resource-acl.service";
import { NotificationService } from "@/modules/websocket/notification.service";

@ApiTags("Resource ACLs")
@ApiBearerAuth()
@Controller("resource-acls")
@UseGuards(JwtOrApiKeyGuard, AclGuard)
export class ResourceAclsController {
  constructor(
    private readonly resourceAcls: ResourceAclService,
    private readonly access: ResourceAccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  @Get()
  @RequirePermission("resource_acls", "read")
  @ApiOperation({ summary: "Ressourcen-ACLs auflisten" })
  async findAll(
    @Query(new ZodValidationPipe(ResourceAclListQuerySchema))
    query: ResourceAclListQuery,
  ) {
    return { success: true, data: await this.resourceAcls.findAll(query) };
  }

  @Get("boundaries")
  @RequirePermission("resource_acls", "read")
  @ApiOperation({ summary: "Vererbungsgrenzen auflisten" })
  async findBoundaries(
    @Query(new ZodValidationPipe(ResourceAclListQuerySchema))
    query: ResourceAclListQuery,
  ) {
    return {
      success: true,
      data: await this.resourceAcls.findBoundaries(query),
    };
  }

  @Post("evaluate")
  @RequirePermission("resource_acls", "read")
  @ApiOperation({ summary: "Effektiven Ressourcenzugriff eines Benutzers prüfen" })
  async evaluate(
    @Body(new ZodValidationPipe(EvaluateResourceAccessSchema))
    input: EvaluateResourceAccessInput,
  ) {
    return {
      success: true,
      data: await this.access.evaluateForUser(input),
    };
  }

  @Post()
  @RequirePermission("resource_acls", "update")
  @ApiOperation({ summary: "Ressourcen-ACL anlegen" })
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateResourceAclEntrySchema))
    input: CreateResourceAclEntryInput,
  ) {
    const data = await this.resourceAcls.create(input);
    await this.audit.log(
      actor.id,
      "resource_acl.created",
      "resource_acl",
      data.id,
      this.entryDetails(data),
      ip,
    );
    this.notifications.notifyPermissionsUpdated(
      "resource_acls",
      "created",
    );
    return { success: true, data };
  }

  @Patch(":id")
  @RequirePermission("resource_acls", "update")
  @ApiOperation({ summary: "Ressourcen-ACL bearbeiten" })
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateResourceAclEntrySchema))
    input: UpdateResourceAclEntryInput,
  ) {
    const data = await this.resourceAcls.update(id, input);
    await this.audit.log(
      actor.id,
      "resource_acl.updated",
      "resource_acl",
      data.id,
      this.entryDetails(data),
      ip,
    );
    this.notifications.notifyPermissionsUpdated(
      "resource_acls",
      "updated",
    );
    return { success: true, data };
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("resource_acls", "update")
  @ApiOperation({ summary: "Ressourcen-ACL löschen" })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.resourceAcls.remove(id);
    await this.audit.log(
      actor.id,
      "resource_acl.deleted",
      "resource_acl",
      data.id,
      this.entryDetails(data),
      ip,
    );
    this.notifications.notifyPermissionsUpdated(
      "resource_acls",
      "deleted",
    );
    return { success: true, data };
  }

  @Put("boundaries")
  @RequirePermission("resource_acls", "update")
  @ApiOperation({ summary: "Vererbung für Ziel und Aktion unterbrechen" })
  async setBoundary(
    @CurrentUser() actor: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(SetResourceAclBoundarySchema))
    input: SetResourceAclBoundaryInput,
  ) {
    const data = await this.resourceAcls.setBoundary(input);
    await this.audit.log(
      actor.id,
      "resource_acl.boundary_set",
      "resource_acl",
      data.id,
      {
        targetType: data.target.type,
        targetId: data.target.id,
        action: data.action,
      },
      ip,
    );
    this.notifications.notifyPermissionsUpdated(
      "resource_acls",
      "boundary_set",
    );
    return { success: true, data };
  }

  @Delete("boundaries/:targetType/:targetId/:action")
  @HttpCode(200)
  @RequirePermission("resource_acls", "update")
  @ApiOperation({ summary: "Vererbungsgrenze entfernen" })
  async removeBoundary(
    @CurrentUser() actor: AuthenticatedUser,
    @Ip() ip: string,
    @Param("targetType", new ZodValidationPipe(ResourceAclTargetTypeSchema))
    targetType: ResourceAclTargetType,
    @Param("targetId", new ParseUUIDPipe()) targetId: string,
    @Param("action", new ZodValidationPipe(ActionSchema)) action: Action,
  ) {
    const data = await this.resourceAcls.removeBoundary({
      targetType,
      targetId,
      action,
    });
    await this.audit.log(
      actor.id,
      "resource_acl.boundary_removed",
      "resource_acl",
      data.id,
      { targetType, targetId, action },
      ip,
    );
    this.notifications.notifyPermissionsUpdated(
      "resource_acls",
      "boundary_removed",
    );
    return { success: true, data };
  }

  private entryDetails(data: {
    recipient: { type: string; id: string };
    target: { type: string; id: string };
    action: string;
    effect: string;
    inheritToChildren: boolean;
  }) {
    return {
      recipientType: data.recipient.type,
      recipientId: data.recipient.id,
      targetType: data.target.type,
      targetId: data.target.id,
      action: data.action,
      effect: data.effect,
      inheritToChildren: data.inheritToChildren,
    };
  }
}
