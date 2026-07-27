import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CreateStandardRuleSchema, CreateStandardSchema, DecideStandardExceptionSchema,
  LinkStandardPageSchema, RequestStandardExceptionSchema, StandardQuerySchema,
  UpdateStandardRuleSchema, UpdateStandardSchema,
  type CreateStandardInput, type CreateStandardRuleInput, type DecideStandardExceptionInput,
  type LinkStandardPageInput, type RequestStandardExceptionInput, type StandardQuery,
  type UpdateStandardInput, type UpdateStandardRuleInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { StandardsService } from "./standards.service";

@ApiTags("Standards")
@ApiBearerAuth()
@Controller("standards")
@UseGuards(JwtOrApiKeyGuard, AclGuard)
export class StandardsController {
  constructor(private readonly standards: StandardsService, private readonly audit: AuditService, private readonly notifications: NotificationService) {}

  @Get() @RequirePermission("standards", "read")
  async list(@CurrentUser() user: AuthenticatedUser, @Query() raw: Record<string, string>) { const query = StandardQuerySchema.parse(raw) as StandardQuery; return { success: true, data: await this.standards.findAll(query, user) }; }
  @Get("options") @RequirePermission("standards", "read")
  async options(@CurrentUser() user: AuthenticatedUser) { return { success: true, data: await this.standards.options(user) }; }
  @Get(":id") @RequirePermission("standards", "read")
  async one(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return { success: true, data: await this.standards.findOne(id, user) }; }
  @Get(":id/versions") @RequirePermission("standards", "read")
  async versions(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return { success: true, data: await this.standards.versions(id, user) }; }

  @Post() @RequirePermission("standards", "create")
  async create(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Body(new ZodValidationPipe(CreateStandardSchema)) input: CreateStandardInput) { const data = await this.standards.create(input, user.id, user); await this.log(user, ip, "standard.created", data.id, data.title); this.notifications.notifyStandardChanged(data.id, "created", user); return { success: true, data }; }
  @Patch(":id") @RequirePermission("standards", "update")
  async update(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string, @Body(new ZodValidationPipe(UpdateStandardSchema)) input: UpdateStandardInput) { const data = await this.standards.update(id, input, user.id, user); await this.log(user, ip, "standard.updated", id, data.title); this.notifications.notifyStandardChanged(id, "updated", user); return { success: true, data }; }
  @Delete(":id") @RequirePermission("standards", "delete") @HttpCode(200)
  async remove(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string) { const data = await this.standards.remove(id, user); await this.log(user, ip, "standard.deleted", id, data.title); this.notifications.notifyStandardChanged(id, "deleted", user); return { success: true, data: null }; }

  @Post(":id/submit") @RequirePermission("standards", "update")
  async submit(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string) { const data = await this.standards.submit(id, user); await this.log(user, ip, "standard.submitted", id, data.title); this.notifications.notifyStandardChanged(id, "submitted", user); return { success: true, data }; }
  @Post(":id/approve") @RequirePermission("standards", "approve")
  async approve(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string) { const data = await this.standards.approve(id, user); await this.log(user, ip, "standard.approved", id, data.title); this.notifications.notifyStandardChanged(id, "approved", user); return { success: true, data }; }
  @Post(":id/deprecate") @RequirePermission("standards", "approve")
  async deprecate(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string) { const data = await this.standards.deprecate(id, user); await this.log(user, ip, "standard.deprecated", id, data.title); this.notifications.notifyStandardChanged(id, "deprecated", user); return { success: true, data }; }

  @Post(":id/rules") @RequirePermission("standards", "update")
  async addRule(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body(new ZodValidationPipe(CreateStandardRuleSchema)) input: CreateStandardRuleInput) { const data = await this.standards.addRule(id, input, user.id, user); this.notifications.notifyStandardChanged(id, "updated", user); return { success: true, data }; }
  @Patch(":id/rules/:ruleId") @RequirePermission("standards", "update")
  async updateRule(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("ruleId") ruleId: string, @Body(new ZodValidationPipe(UpdateStandardRuleSchema)) input: UpdateStandardRuleInput) { const data = await this.standards.updateRule(id, ruleId, input, user.id, user); this.notifications.notifyStandardChanged(id, "updated", user); return { success: true, data }; }
  @Delete(":id/rules/:ruleId") @RequirePermission("standards", "update")
  async removeRule(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("ruleId") ruleId: string) { const data = await this.standards.removeRule(id, ruleId, user.id, user); this.notifications.notifyStandardChanged(id, "updated", user); return { success: true, data }; }

  @Post(":id/pages") @RequirePermission("standards", "update")
  async linkPage(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body(new ZodValidationPipe(LinkStandardPageSchema)) input: LinkStandardPageInput) { return { success: true, data: await this.standards.linkPage(id, input.pageId, user) }; }
  @Delete(":id/pages/:pageId") @RequirePermission("standards", "update")
  async unlinkPage(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Param("pageId") pageId: string) { return { success: true, data: await this.standards.unlinkPage(id, pageId, user) }; }
  @Post(":id/exceptions") @RequirePermission("standards", "read")
  async requestException(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string, @Body(new ZodValidationPipe(RequestStandardExceptionSchema)) input: RequestStandardExceptionInput) { const data = await this.standards.requestException(id, input, user.id, user); await this.log(user, ip, "standard.exception_requested", id, data.title); this.notifications.notifyStandardChanged(id, "exception", user); return { success: true, data }; }
  @Patch(":id/exceptions/:exceptionId") @RequirePermission("standards", "approve")
  async decideException(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string, @Param("id") id: string, @Param("exceptionId") exceptionId: string, @Body(new ZodValidationPipe(DecideStandardExceptionSchema)) input: DecideStandardExceptionInput) { const data = await this.standards.decideException(id, exceptionId, input, user.id, user); await this.log(user, ip, "standard.exception_decided", id, data.title); this.notifications.notifyStandardChanged(id, "exception", user); return { success: true, data }; }

  private async log(user: AuthenticatedUser, ip: string, action: string, id: string, title: string) { await this.audit.log(user.id, action, "standard", id, { title }, ip); }
}
