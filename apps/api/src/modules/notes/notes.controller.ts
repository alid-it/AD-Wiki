import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CreateNoteSchema,
  NoteQuerySchema,
  PromoteNoteSchema,
  ShareNoteSchema,
  UpdateNoteSchema,
  ToggleCheckboxSchema,
  type ToggleCheckboxInput,
  type NoteQuery,
  type PromoteNoteInput,
  type ShareNoteInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import type { CreateNoteDto } from "@/modules/notes/dto/create-note.dto";
import type { UpdateNoteDto } from "@/modules/notes/dto/update-note.dto";
import { NotesService } from "@/modules/notes/notes.service";
import { MicrosoftIntegrationService } from "@/modules/integrations/microsoft-integration.service";
import { NotificationService } from "@/modules/websocket/notification.service";

@ApiTags("Notes")
@ApiBearerAuth()
@Controller("notes")
export class NotesController {
  constructor(private readonly notes: NotesService, private readonly audit: AuditService, private readonly notifications: NotificationService, private readonly microsoft: MicrosoftIntegrationService) {}

  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "read")
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(NoteQuerySchema)) query: NoteQuery) {
    return { success: true, data: await this.notes.findAll(user.id, query, user) };
  }

  @Get("trash")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "read")
  async trash(@CurrentUser() user: AuthenticatedUser) { return { success: true, data: await this.notes.findTrash(user.id, user) }; }

  @Get("share-candidates")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "share")
  async candidates(@CurrentUser() user: AuthenticatedUser) { return { success: true, data: await this.notes.shareCandidates(user.id) }; }

  @Get(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "read")
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return { success: true, data: await this.notes.findOne(id, user.id, user) }; }

  @Post()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "create")
  async create(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Body(new ZodValidationPipe(CreateNoteSchema)) dto: CreateNoteDto) {
    const data = await this.notes.create(dto, user.id, user);
    await this.audit.log(user.id, "note.created", "note", data.id, { title: data.title }, ip);
    this.emit(data, user, "created");
    return { success: true, data };
  }

  @Patch(":id/checkbox")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "update")
  async toggleCheckbox(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ToggleCheckboxSchema)) dto: ToggleCheckboxInput,
  ) {
    const data = await this.notes.toggleCheckbox(id, dto, user.id, user);
    this.emit(data, user, "updated");
    return { success: true, data };
  }

  @Patch(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "update")
  async update(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string, @Body(new ZodValidationPipe(UpdateNoteSchema)) dto: UpdateNoteDto) {
    const data = await this.notes.update(id, dto, user.id, user);
    await this.audit.log(user.id, "note.updated", "note", id, { title: data.title }, ip);
    this.emit(data, user, "updated");
    return { success: true, data };
  }

  @Delete(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "delete")
  async remove(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string) {
    const data = await this.notes.remove(id, user.id, user);
    await this.audit.log(user.id, "note.deleted", "note", id, { title: data.title }, ip);
    this.emit(data, user, "deleted");
    return { success: true, data: null };
  }

  @Post(":id/restore")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "delete")
  async restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const data = await this.notes.restore(id, user.id, user);
    this.emit(data, user, "restored");
    return { success: true, data };
  }

  @Delete(":id/permanent")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "delete")
  async permanent(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Query("deleteExternal") deleteExternal: string | undefined,
  ) {
    await this.microsoft.handlePermanentNoteDeletion(user.id, id, deleteExternal === "true", ip);
    const data = await this.notes.permanentRemove(id, user.id, user);
    this.notifications.notifyNoteChanged(data, user, "deleted", [user.id]);
    return { success: true, data: null };
  }

  @Post(":id/share")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "share")
  async share(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body(new ZodValidationPipe(ShareNoteSchema)) dto: ShareNoteInput) {
    const data = await this.notes.share(id, dto, user.id, user);
    this.emit(data, user, "shared");
    return { success: true, data };
  }

  @Delete(":id/share/:userId")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "share")
  async unshare(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("userId") target: string) {
    const data = await this.notes.unshare(id, target, user.id, user);
    this.emit(data, user, "shared", [target]);
    return { success: true, data };
  }

  @Post(":id/promote-to-wiki")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("notes", "update")
  async promote(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body(new ZodValidationPipe(PromoteNoteSchema)) dto: PromoteNoteInput) {
    return { success: true, data: await this.notes.promoteToWiki(id, dto, user) };
  }

  private emit(note: { id: string; title: string | null; ownerId: string; shares: Array<{ user: { id: string } }> }, actor: AuthenticatedUser, action: "created" | "updated" | "deleted" | "restored" | "shared", extra: string[] = []) {
    this.notifications.notifyNoteChanged(note, actor, action, [note.ownerId, ...note.shares.map((share) => share.user.id), ...extra]);
  }
}
