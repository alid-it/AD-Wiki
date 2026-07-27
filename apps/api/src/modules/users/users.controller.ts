import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  AdminResetPasswordSchema,
  AssignUserRoleSchema,
  CreateUserSchema,
  UpdateProfileSchema,
  UpdateUserSchema,
  type AdminResetPasswordInput,
  type AssignUserRoleInput,
  type CreateUserInput,
  type UpdateProfileInput,
  type UpdateUserInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import {
  RequirePermission,
  RequirePermissions,
} from "@/modules/auth/decorators/require-permission.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthService } from "@/modules/auth/auth.service";
import { UsersService } from "@/modules/users/users.service";
import { NotificationService } from "@/modules/websocket/notification.service";

/** REST-Endpunkte für das eigene Profil und die Benutzerverwaltung (Admin). */
@ApiTags("Users")
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    private readonly notifications: NotificationService,
  ) {}

  /** Eigenes Profil bearbeiten (jeder eingeloggte User). */
  @Patch("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Eigenes Profil aktualisieren" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["displayName"],
      properties: { displayName: { type: "string", example: "Max Mustermann" } },
    },
  })
  @ApiResponse({ status: 200, description: "Profil wurde aktualisiert." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) dto: UpdateProfileInput,
  ) {
    const data = await this.usersService.updateProfile(user.id, dto);
    return { success: true, data };
  }

  /** Neuen Benutzer mit Startpasswort anlegen (Admin). */
  @Post()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermissions(
    { resource: "users", action: "create" },
    { resource: "users", action: "assign_role" },
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: "Benutzer anlegen (Admin)" })
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserInput,
  ) {
    const data = await this.usersService.create(dto, current.id);
    await this.audit.log(current.id, "user.created", "user", data.id, {
      email: data.email,
      username: data.username,
      role: data.role,
    }, ip);
    return { success: true, data };
  }

  /** Alle Benutzer auflisten (Admin). */
  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Alle Benutzer auflisten (Admin)" })
  @ApiResponse({ status: 200, description: "Liste aller Benutzer." })
  @ApiResponse({ status: 403, description: "Keine Admin-Rechte." })
  async findAll() {
    const data = await this.usersService.findAll();
    return { success: true, data };
  }

  /** Verfügbare Rollen für Benutzeranlage und sensible Rollenzuweisung. */
  @Get("role-options")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "assign_role")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Verfügbare Rollen für die Benutzerverwaltung" })
  async roleOptions() {
    return { success: true, data: await this.usersService.roleOptions() };
  }

  /** Einzelnen Benutzer laden (Admin). */
  @Get(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Einzelnen Benutzer laden (Admin)" })
  @ApiParam({ name: "id", description: "UUID des Benutzers" })
  @ApiResponse({ status: 200, description: "Der gefundene Benutzer." })
  @ApiResponse({ status: 404, description: "Benutzer nicht gefunden." })
  async findOne(@Param("id") id: string) {
    const data = await this.usersService.findOne(id);
    return { success: true, data };
  }

  /** Reset-Link an die hinterlegte E-Mail-Adresse senden (Admin). */
  @Post(":id/password-reset-email")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "reset_password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Passwort-Reset-Mail senden (Admin)" })
  async sendPasswordResetEmail(
    @CurrentUser() current: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
  ) {
    const data = await this.authService.sendPasswordResetForUser(id);
    await this.audit.log(current.id, "user.password_reset_email_sent", "user", id, {
      recipient: data.recipient,
    }, ip);
    return { success: true, data: { message: "Reset-E-Mail wurde versendet." } };
  }

  /** Passwort eines anderen Benutzers direkt neu setzen (Admin). */
  @Post(":id/password")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "reset_password")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Passwort direkt zurücksetzen (Admin)" })
  async resetPassword(
    @CurrentUser() current: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AdminResetPasswordSchema)) dto: AdminResetPasswordInput,
  ) {
    if (id === current.id) {
      throw new ForbiddenException("Nutze für dein eigenes Konto den Passwortwechsel im Profil.");
    }
    await this.authService.resetPasswordByAdmin(id, dto.newPassword);
    await this.audit.log(current.id, "user.password_reset_by_admin", "user", id, null, ip);
    return { success: true, data: { message: "Passwort wurde zurückgesetzt." } };
  }

  /** Rolle eines Benutzers getrennt von normalen Kontofeldern ändern. */
  @Patch(":id/role")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "assign_role")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Benutzerrolle zuweisen" })
  @ApiParam({ name: "id", description: "UUID des Benutzers" })
  async assignRole(
    @CurrentUser() current: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignUserRoleSchema)) dto: AssignUserRoleInput,
  ) {
    if (id === current.id && dto.roleId !== current.roleId) {
      throw new ForbiddenException("Du kannst deine eigene Rolle nicht ändern.");
    }
    const data = await this.usersService.assignRole(id, dto, current.id);
    await this.audit.log(
      current.id,
      "user.role_changed",
      "user",
      id,
      { displayName: data.displayName, roleId: dto.roleId, role: data.role },
      ip,
    );
    this.notifications.notifyPermissionsUpdated();
    return { success: true, data };
  }

  /** Normale Kontofelder eines Benutzers ändern. */
  @Patch(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Benutzerstatus bearbeiten" })
  @ApiParam({ name: "id", description: "UUID des Benutzers" })
  @ApiResponse({ status: 200, description: "Benutzer wurde aktualisiert." })
  @ApiResponse({ status: 403, description: "Keine Admin-Rechte oder Selbstsperre." })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserInput,
  ) {
    // Selbst-Aussperren verhindern: eigenen Zugang nicht deaktivieren.
    if (id === current.id) {
      if (dto.isActive === false) {
        throw new ForbiddenException("Du kannst dein eigenes Konto nicht deaktivieren.");
      }
    }
    const data = await this.usersService.updateByAdmin(id, dto);

    if (dto.isActive !== undefined) {
      await this.audit.log(
        current.id,
        dto.isActive ? "user.activated" : "user.deactivated",
        "user",
        id,
        { displayName: data.displayName },
        ip,
      );
    }
    return { success: true, data };
  }

  /** Benutzer deaktivieren (Soft-Delete, Admin). */
  @Delete(":id")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("users", "delete")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Benutzer deaktivieren (Admin)" })
  @ApiParam({ name: "id", description: "UUID des Benutzers" })
  @ApiResponse({ status: 200, description: "Benutzer wurde deaktiviert." })
  @ApiResponse({ status: 403, description: "Keine Admin-Rechte oder Selbstsperre." })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
  ) {
    if (id === current.id) {
      throw new ForbiddenException("Du kannst dein eigenes Konto nicht deaktivieren.");
    }
    const data = await this.usersService.deactivate(id);
    await this.audit.log(
      current.id,
      "user.deactivated",
      "user",
      id,
      { displayName: data.displayName },
      ip,
    );
    return { success: true, data };
  }
}
