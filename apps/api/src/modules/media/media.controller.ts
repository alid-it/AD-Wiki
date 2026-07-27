import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { MediaQuerySchema, SetMediaPagesSchema, type SetMediaPagesInput } from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { MediaService } from "@/modules/media/media.service";
import { multerOptions } from "@/modules/media/media.config";
import type { MediaQuery } from "@ad-wiki/shared-types";
import { MediaFileGuard } from "@/modules/media/guards/media-file.guard";
import { AuthService } from "@/modules/auth/auth.service";

/** REST-Endpunkte zum Hochladen, Auflisten und Löschen von Medien. */
@ApiTags("Media")
@Controller("media")
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly authService: AuthService,
  ) {}

  /** Datei hochladen (geschützt). */
  @Post("upload")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("media", "create")
  // Missbrauchsschutz: max. 10 Uploads pro Minute und Benutzer.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file", multerOptions))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Datei hochladen (Bild, PDF oder Markdown)" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Datei wurde hochgeladen." })
  @ApiResponse({ status: 400, description: "Kein oder ungültiger Dateityp." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ) {
    if (!file) {
      throw new BadRequestException("Es wurde keine Datei übermittelt.");
    }
    const data = await this.mediaService.create(file, user.id);
    await this.audit.log(
      user.id,
      "media.uploaded",
      "media",
      data.id,
      { filename: data.filename, mimetype: data.mimetype, size: data.size },
      ip,
    );
    this.notifications.notifyMediaUploaded({ id: data.id, filename: data.filename }, user);
    return { success: true, data };
  }

  /** Markdown hochladen und automatisch als Wiki-Seite importieren. */
  @Post("import-markdown")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("media", "create")
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file", multerOptions))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Markdown-Datei hochladen und als Wiki-Seite importieren" })
  async importMarkdown(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Es wurde keine Datei übermittelt.");
    const data = await this.mediaService.importMarkdown(file, user.id, user);
    return { success: true, data };
  }

  /** Seitenzuordnungen eines Mediums ersetzen. */
  @Put(":id/pages")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("media", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Medium Wiki-Seiten zuordnen" })
  async setPages(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetMediaPagesSchema)) input: SetMediaPagesInput,
  ) {
    const data = await this.mediaService.setPages(id, input, user);
    return { success: true, data };
  }

  /** Alle Medien paginiert auflisten. */
  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("media", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Medien paginiert auflisten" })
  @ApiResponse({ status: 200, description: "Liste der Medien." })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(MediaQuerySchema)) query: MediaQuery,
  ) {
    const permissions = await this.authService.getEffectivePermissions(user.id);
    const canManageAll =
      permissions.some(
        (entry) =>
          entry.resource === "media" &&
          (entry.action === "update" || entry.action === "delete") &&
          entry.allowed,
      ) &&
      (user.apiKeyPermissions === undefined ||
        user.apiKeyPermissions === null ||
        user.apiKeyPermissions.some(
          (entry) =>
            entry.resource === "media" &&
            (entry.action === "update" || entry.action === "delete"),
        ));
    const { data, meta } = await this.mediaService.findAll(query, user.id, canManageAll, user);
    return { success: true, data, meta };
  }

  /** Datei ausschliesslich ueber die API streamen; JWT oder oeffentliche Seite. */
  @Get(":id/file")
  @UseGuards(MediaFileGuard)
  @ApiOperation({ summary: "Mediendatei geschuetzt streamen" })
  @ApiParam({ name: "id", description: "UUID des Mediums" })
  async file(
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.mediaService.fileInfo(id);
    const encodedName = encodeURIComponent(file.filename);
    response.set({
      "Content-Type": file.mimetype,
      "Content-Length": String(file.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(createReadStream(file.absolutePath));
  }

  /** Einzelne Datei-Info. */
  @Get(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("media", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Einzelne Datei-Info abrufen" })
  @ApiParam({ name: "id", description: "UUID des Mediums" })
  @ApiResponse({ status: 200, description: "Das gefundene Medium." })
  @ApiResponse({ status: 404, description: "Medium nicht gefunden." })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const data = await this.mediaService.findOne(id, user);
    return { success: true, data };
  }

  /** Datei löschen (geschützt). */
  @Delete(":id")
  @HttpCode(200)
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("media", "delete")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Datei löschen" })
  @ApiParam({ name: "id", description: "UUID des Mediums" })
  @ApiResponse({ status: 200, description: "Datei wurde gelöscht." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  @ApiResponse({ status: 404, description: "Medium nicht gefunden." })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
  ) {
    const deleted = await this.mediaService.remove(id, user);
    await this.audit.log(
      user.id,
      "media.deleted",
      "media",
      deleted.id,
      { filename: deleted.filename },
      ip,
    );
    this.notifications.notifyMediaDeleted(deleted.filename, user);
    return { success: true, data: null };
  }
}
