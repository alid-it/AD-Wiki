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
  CreateKnowledgeSpaceSchema,
  UpdateKnowledgeSpaceSchema,
  type CreateKnowledgeSpaceInput,
  type UpdateKnowledgeSpaceInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { AuditService } from "@/modules/audit/audit.service";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { SpacesService } from "@/modules/spaces/spaces.service";
import { NotificationService } from "@/modules/websocket/notification.service";

@ApiTags("Knowledge Spaces")
@ApiBearerAuth()
@Controller("spaces")
@UseGuards(JwtOrApiKeyGuard, AclGuard)
export class SpacesController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  @Get()
  @RequirePermission("spaces", "read")
  @ApiOperation({ summary: "Wissensbereiche auflisten" })
  async findAll(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.spaces.findAll(user) };
  }

  @Get(":id")
  @RequirePermission("spaces", "read")
  @ApiOperation({ summary: "Wissensbereich laden" })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return { success: true, data: await this.spaces.findById(id, user) };
  }

  @Post()
  @RequirePermission("spaces", "create")
  @ApiOperation({ summary: "Wissensbereich erstellen" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateKnowledgeSpaceSchema))
    input: CreateKnowledgeSpaceInput,
  ) {
    const data = await this.spaces.create(input, user);
    await this.audit.log(
      user.id,
      "space.created",
      "space",
      data.id,
      { name: data.name, slug: data.slug, visibility: data.visibility },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("spaces", "created");
    return { success: true, data };
  }

  @Patch(":id")
  @RequirePermission("spaces", "update")
  @ApiOperation({ summary: "Wissensbereich bearbeiten" })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateKnowledgeSpaceSchema))
    input: UpdateKnowledgeSpaceInput,
  ) {
    const data = await this.spaces.update(id, input, user);
    await this.audit.log(
      user.id,
      "space.updated",
      "space",
      id,
      { name: data.name, slug: data.slug, visibility: data.visibility },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("spaces", "updated");
    return { success: true, data };
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("spaces", "delete")
  @ApiOperation({ summary: "Leeren Wissensbereich löschen" })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.spaces.remove(id, user);
    await this.audit.log(
      user.id,
      "space.deleted",
      "space",
      id,
      { name: data.name, slug: data.slug },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("spaces", "deleted");
    return { success: true, data };
  }
}
