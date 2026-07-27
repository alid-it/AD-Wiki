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
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import {
  AddGroupMemberSchema,
  CreateGroupSchema,
  GroupMemberCandidatesQuerySchema,
  UpdateGroupMemberSchema,
  UpdateGroupSchema,
  type AddGroupMemberInput,
  type CreateGroupInput,
  type GroupMemberCandidatesQuery,
  type UpdateGroupInput,
  type UpdateGroupMemberInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { AuditService } from "@/modules/audit/audit.service";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { GroupsService } from "@/modules/groups/groups.service";
import { NotificationService } from "@/modules/websocket/notification.service";

@ApiTags("Groups")
@ApiBearerAuth()
@Controller("groups")
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("groups", "read")
  @ApiOperation({ summary: "Alle Gruppen auflisten" })
  async findAll() {
    return { success: true, data: await this.groups.findAll() };
  }

  @Get("mine")
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({ summary: "Eigene Gruppenmitgliedschaften auflisten" })
  async findMine(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.groups.findOwnMemberships(user.id),
    };
  }

  @Post()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("groups", "create")
  @ApiOperation({ summary: "Gruppe erstellen" })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateGroupSchema)) input: CreateGroupInput,
  ) {
    const data = await this.groups.create(input);
    await this.audit.log(
      user.id,
      "group.created",
      "group",
      data.id,
      { name: data.name, slug: data.slug },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("groups", "created");
    return { success: true, data };
  }

  @Get(":id/members")
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({
    summary: "Gruppenmitglieder auflisten",
    description:
      "Erfordert groups:read, groups:manage_members oder eine eigene MANAGER-Mitgliedschaft.",
  })
  @ApiParam({ name: "id", description: "UUID der Gruppe" })
  async findMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return {
      success: true,
      data: await this.groups.findMembers(id, user),
    };
  }

  @Get(":id/member-candidates")
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({
    summary: "Zulässige Kandidaten für eine Gruppenmitgliedschaft suchen",
    description:
      "Erfordert groups:manage_members oder eine eigene MANAGER-Mitgliedschaft. Es werden nur minimale Profildaten geliefert.",
  })
  async findMemberCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(GroupMemberCandidatesQuerySchema))
    query: GroupMemberCandidatesQuery,
  ) {
    return {
      success: true,
      data: await this.groups.findMemberCandidates(id, query, user),
    };
  }

  @Post(":id/members")
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({
    summary: "Benutzer einer Gruppe hinzufügen",
    description:
      "Erfordert groups:manage_members oder eine eigene MANAGER-Mitgliedschaft.",
  })
  async addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(AddGroupMemberSchema))
    input: AddGroupMemberInput,
  ) {
    const data = await this.groups.addMember(id, input, user);
    await this.audit.log(
      user.id,
      "group.member_added",
      "group",
      id,
      {
        memberId: data.userId,
        displayName: data.user.displayName,
        membershipRole: data.role,
      },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("groups", "member_added");
    return { success: true, data };
  }

  @Patch(":id/members/:userId")
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({
    summary: "Rolle eines Gruppenmitglieds ändern",
    description: "Erfordert das globale Recht groups:manage_members.",
  })
  async updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(UpdateGroupMemberSchema))
    input: UpdateGroupMemberInput,
  ) {
    const data = await this.groups.updateMember(id, userId, input, user);
    await this.audit.log(
      user.id,
      "group.member_role_changed",
      "group",
      id,
      {
        memberId: data.userId,
        displayName: data.user.displayName,
        membershipRole: data.role,
      },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("groups", "member_updated");
    return { success: true, data };
  }

  @Delete(":id/members/:userId")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({
    summary: "Benutzer aus einer Gruppe entfernen",
    description:
      "Erfordert groups:manage_members oder eine eigene MANAGER-Mitgliedschaft.",
  })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ) {
    const data = await this.groups.removeMember(id, userId, user);
    await this.audit.log(
      user.id,
      "group.member_removed",
      "group",
      id,
      {
        memberId: data.userId,
        displayName: data.user.displayName,
        membershipRole: data.role,
      },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("groups", "member_removed");
    return { success: true, data };
  }

  @Get(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("groups", "read")
  @ApiOperation({ summary: "Gruppe laden" })
  async findById(@Param("id", new ParseUUIDPipe()) id: string) {
    return { success: true, data: await this.groups.findById(id) };
  }

  @Patch(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("groups", "update")
  @ApiOperation({ summary: "Gruppe bearbeiten" })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateGroupSchema)) input: UpdateGroupInput,
  ) {
    const data = await this.groups.update(id, input);
    await this.audit.log(
      user.id,
      "group.updated",
      "group",
      id,
      { name: data.name, slug: data.slug },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("groups", "updated");
    return { success: true, data };
  }

  @Delete(":id")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("groups", "delete")
  @ApiOperation({ summary: "Leere Gruppe löschen" })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.groups.remove(id);
    await this.audit.log(
      user.id,
      "group.deleted",
      "group",
      id,
      { name: data.name, slug: data.slug },
      ip,
    );
    this.notifications.notifyPermissionsUpdated("groups", "deleted");
    return { success: true, data };
  }
}
