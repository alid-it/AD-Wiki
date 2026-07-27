import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  SelectMicrosoftTodoListsSchema,
  CreateMicrosoftTodoTaskSchema,
  type CreateMicrosoftTodoTaskInput,
  type SelectMicrosoftTodoListsInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { MicrosoftIntegrationService } from "./microsoft-integration.service";

@ApiTags("Integrations")
@Controller("integrations/microsoft")
export class IntegrationsController {
  constructor(private readonly microsoft: MicrosoftIntegrationService) {}

  @Get("status")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "read")
  @ApiOperation({ summary: "Status der eigenen Microsoft-To-Do-Verbindung" })
  async status(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.microsoft.status(user.id) };
  }

  @Post("oauth/start")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "create")
  @ApiOperation({ summary: "Geschützten Microsoft OAuth Authorization Code Flow starten" })
  async start(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.microsoft.startOAuth(user.id) };
  }

  @Get("callback")
  @ApiOperation({ summary: "Microsoft OAuth Callback" })
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Ip() ipAddress: string,
    @Res() response: Response,
  ) {
    if (!state) return response.redirect(this.microsoft.webRedirect("error"));
    if (error || !code) {
      await this.microsoft.discardOAuthState(state);
      return response.redirect(this.microsoft.webRedirect(error === "access_denied" ? "denied" : "error"));
    }
    try {
      await this.microsoft.completeOAuth(code, state, ipAddress);
      return response.redirect(this.microsoft.webRedirect("connected"));
    } catch {
      return response.redirect(this.microsoft.webRedirect("error"));
    }
  }

  @Get("lists")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "read")
  async lists(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.microsoft.lists(user.id) };
  }

  @Put("lists")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "update")
  async selectLists(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(SelectMicrosoftTodoListsSchema)) input: SelectMicrosoftTodoListsInput,
  ) {
    return { success: true, data: await this.microsoft.selectLists(user.id, input.listIds) };
  }

  @Post("sync")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "update")
  async sync(@CurrentUser() user: AuthenticatedUser, @Ip() ipAddress: string) {
    return { success: true, data: await this.microsoft.sync(user.id, ipAddress) };
  }

  @Post("tasks")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "update")
  @ApiOperation({ summary: "Eigene Notiz als Microsoft-To-Do-Aufgabe anlegen" })
  async createTask(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ipAddress: string,
    @Body(new ZodValidationPipe(CreateMicrosoftTodoTaskSchema)) input: CreateMicrosoftTodoTaskInput,
  ) {
    return { success: true, data: await this.microsoft.exportNote(user.id, input.noteId, input.listId, ipAddress) };
  }

  @Get("sync-runs")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "read")
  async syncRuns(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.microsoft.syncRuns(user.id) };
  }

  @Delete("connection")
  @ApiBearerAuth()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("integrations", "delete")
  async disconnect(@CurrentUser() user: AuthenticatedUser, @Ip() ipAddress: string) {
    return { success: true, data: await this.microsoft.disconnect(user.id, ipAddress) };
  }
}
