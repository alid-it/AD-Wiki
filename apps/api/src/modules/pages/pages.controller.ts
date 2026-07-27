import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  CreatePageSchema,
  ImportMarkdownSchema,
  PageQuerySchema,
  RelatedPagesQuerySchema,
  SavePageDraftSchema,
  UpdatePageSchema,
  ToggleCheckboxSchema,
  type ToggleCheckboxInput,
  type ImportMarkdownInput,
  type PageQuery,
  type RelatedPagesQuery,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { PagesService } from "@/modules/pages/pages.service";
import type { CreatePageDto } from "@/modules/pages/dto/create-page.dto";
import type { UpdatePageDto } from "@/modules/pages/dto/update-page.dto";
import type { SavePageDraftDto } from "@/modules/pages/dto/save-page-draft.dto";

/** REST-Endpunkte zur Verwaltung von Seiten und Ordnern. */
@ApiTags("Pages")
@Controller("pages")
export class PagesController {
  constructor(
    private readonly pagesService: PagesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Paginierte, filterbare Liste aller Seiten. */
  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Seiten auflisten (paginiert, filterbar)" })
  @ApiQuery({ name: "status", required: false, enum: ["draft", "published", "archived"] })
  @ApiQuery({ name: "category", required: false, description: "Kategorie-Slug" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "perPage", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Paginierte Seitenliste." })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(PageQuerySchema)) query: PageQuery,
  ) {
    const { data, meta } = await this.pagesService.findAll(query, user);
    return { success: true, data, meta };
  }

  /**
   * Baumstruktur einer Kategorie für die Sidebar.
   * Steht bewusst vor `:slug`, damit "tree" nicht als Slug interpretiert wird.
   */
  @Get("tree/:categorySlug")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Baumstruktur (Kategorie → Ordner → Seiten) laden" })
  @ApiParam({ name: "categorySlug", description: "Slug der Kategorie" })
  @ApiResponse({ status: 200, description: "Verschachtelte Baumstruktur." })
  @ApiResponse({ status: 404, description: "Kategorie nicht gefunden." })
  async tree(
    @CurrentUser() user: AuthenticatedUser,
    @Param("categorySlug") categorySlug: string,
    @Query("spaceId") spaceId?: string,
  ) {
    const data = await this.pagesService.buildTree(categorySlug, spaceId, user);
    return { success: true, data };
  }

  /**
   * Baumstruktur der Seiten ohne Kategorie.
   * Steht bewusst vor `:slug`, damit "uncategorized" nicht als Slug gilt.
   */
  @Get("uncategorized")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Seiten ohne Kategorie als Baum laden" })
  @ApiResponse({ status: 200, description: "Ordner und Seiten ohne Kategorie." })
  async uncategorized(
    @CurrentUser() user: AuthenticatedUser,
    @Query("spaceId") spaceId?: string,
  ) {
    const data = await this.pagesService.buildUncategorizedTree(spaceId, user);
    return { success: true, data };
  }

  /** Bekannte Tags alphabetisch für die Auswahl im Editor. */
  @Get("tags")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Bekannte Tags auflisten" })
  async tags(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.pagesService.findTags(user);
    return { success: true, data };
  }

  @Get("graph")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  async graph(@CurrentUser() user: AuthenticatedUser, @Query("mode") mode?: string) {
    return { success: true, data: await this.pagesService.findGraph(user, mode === "mcp") };
  }

  @Get(":slug/backlinks")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  async backlinks(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
  ) {
    return {
      success: true,
      data: await this.pagesService.findBacklinks(slug, user),
    };
  }

  @Get(":slug/standard-backlinks")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  async standardBacklinks(@CurrentUser() user: AuthenticatedUser, @Param("slug") slug: string) {
    return { success: true, data: await this.pagesService.findStandardBacklinks(slug, user) };
  }

  /** Öffentliche Leseseite – bewusst ohne JWT und ohne interne Metadaten. */
  @Get("public/:slug")
  @ApiOperation({ summary: "Öffentliche, veröffentlichte Wiki-Seite lesen" })
  @ApiParam({ name: "slug", description: "Slug der öffentlichen Seite" })
  async publicBySlug(@Param("slug") slug: string) {
    return { success: true, data: await this.pagesService.findPublicBySlug(slug) };
  }

  @Get("trash")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  async trash(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.pagesService.findTrash(user),
    };
  }

  /** Nach gemeinsamen Tags und anschließend gemeinsamer Kategorie sortierte Seiten. */
  @Get(":id/related")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Verwandte Wiki-Seiten ermitteln" })
  @ApiParam({ name: "id", description: "UUID der Ausgangsseite" })
  @ApiQuery({ name: "limit", required: false, type: Number, example: 5 })
  async related(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query(new ZodValidationPipe(RelatedPagesQuerySchema)) query: RelatedPagesQuery,
  ) {
    return {
      success: true,
      data: await this.pagesService.findRelated(id, query.limit, user),
    };
  }

  @Delete("trash/permanent")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "purge")
  @ApiBearerAuth()
  @HttpCode(200)
  async emptyTrash(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.pagesService.emptyTrash(user);
    await this.audit.log(user.id, "page.deleted", "page", null, { permanent: true, emptiedTrash: count });
    this.notifications.notifyPageDeleted("Papierkorb", user);
    return { success: true, data: { count } };
  }

  /** Versionshistorie einer Seite. */
  @Get(":id/versions")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Versionshistorie einer Seite laden" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  @ApiResponse({ status: 200, description: "Liste der Versionen (neueste zuerst)." })
  @ApiResponse({ status: 404, description: "Seite nicht gefunden." })
  async versions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const data = await this.pagesService.findVersions(id, user);
    return { success: true, data };
  }

  /** Autosave-Entwurf des aktuellen Benutzers für diese Seite laden. */
  @Get(":id/draft")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Autosave-Entwurf der Seite (pro Benutzer) laden" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  async getDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return { success: true, data: await this.pagesService.findDraft(id, user.id, user) };
  }

  /** Autosave-Entwurf speichern (Upsert – überschreibt den vorherigen). */
  @Put(":id/draft")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Autosave-Entwurf der Seite speichern" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  async saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SavePageDraftSchema)) dto: SavePageDraftDto,
  ) {
    return { success: true, data: await this.pagesService.saveDraft(id, user.id, dto, user) };
  }

  /** Autosave-Entwurf verwerfen. */
  @Delete(":id/draft")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: "Autosave-Entwurf der Seite verwerfen" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  async deleteDraft(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.pagesService.deleteDraft(id, user.id, user);
    return { success: true, data: null };
  }

  /** Einzelne Seite anhand des Slugs. */
  @Get(":slug")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Einzelne Seite laden" })
  @ApiParam({ name: "slug", description: "Slug der Seite" })
  @ApiResponse({ status: 200, description: "Die gefundene Seite." })
  @ApiResponse({ status: 404, description: "Seite nicht gefunden." })
  async findBySlug(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
  ) {
    const data = await this.pagesService.findBySlug(slug, user);
    return { success: true, data };
  }

  /**
   * Neue Seite oder Ordner erstellen.
   * Nur für authentifizierte Redakteure/Admins. Der Autor wird aus dem
   * JWT abgeleitet – ein `authorId` im Body wird bewusst ignoriert.
   */
  @Post()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "create")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Neue Seite oder Ordner erstellen" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", example: "Erste Seite" },
        spaceId: { type: "string", format: "uuid" },
        type: { type: "string", enum: ["folder", "page"], example: "page" },
        content: { type: "string", example: "# Willkommen" },
        excerpt: { type: "string", example: "Kurze Zusammenfassung" },
        status: {
          type: "string",
          enum: ["draft", "published", "archived"],
          example: "draft",
        },
        categoryId: { type: "string", format: "uuid" },
        parentId: { type: "string", format: "uuid" },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Seite wurde erstellt." })
  @ApiResponse({ status: 400, description: "Ungültige Eingabedaten." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  @ApiResponse({ status: 403, description: "Keine Schreibrechte." })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreatePageSchema)) dto: CreatePageDto,
  ) {
    const data = await this.pagesService.create(dto, user.id, user);
    await this.audit.log(
      user.id,
      "page.created",
      "page",
      data.id,
      { title: data.title, slug: data.slug, type: data.type, status: data.status },
      ip,
    );
    this.notifications.notifyPageCreated(
      { id: data.id, title: data.title, slug: data.slug, type: data.type },
      user,
    );
    return { success: true, data };
  }

  /** Eine hochgeladene Markdown-Datei als neue Wiki-Seite importieren. */
  @Post("import-markdown")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "create")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Markdown-Medium als Wiki-Seite importieren" })
  @ApiResponse({ status: 201, description: "Seite wurde aus der Datei erstellt." })
  @ApiResponse({ status: 400, description: "Kein gültiges Markdown-Medium." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  @ApiResponse({ status: 403, description: "Keine Schreibrechte." })
  @ApiResponse({ status: 404, description: "Medium nicht gefunden." })
  async importMarkdown(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(ImportMarkdownSchema)) dto: ImportMarkdownInput,
  ) {
    const data = await this.pagesService.importMarkdownFromMedia(dto, user.id, user);
    await this.audit.log(
      user.id,
      "page.created",
      "page",
      data.id,
      { title: data.title, slug: data.slug, importedFromMedia: dto.mediaId },
      ip,
    );
    this.notifications.notifyPageCreated(
      { id: data.id, title: data.title, slug: data.slug, type: data.type },
      user,
    );
    return { success: true, data };
  }

  /** Seite bearbeiten – erzeugt automatisch eine PageVersion. */
  @Patch(":id/checkbox")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Checklisteneintrag ohne neue Seitenversion schalten" })
  async toggleCheckbox(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ToggleCheckboxSchema)) dto: ToggleCheckboxInput,
  ) {
    const data = await this.pagesService.toggleCheckbox(id, dto, user);
    this.notifications.notifyPageUpdated(
      { id: data.id, title: data.title, slug: data.slug },
      user,
    );
    return { success: true, data };
  }

  /** Seite bearbeiten – erzeugt automatisch eine PageVersion. */
  @Patch(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Seite bearbeiten (erstellt automatisch eine Version)" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  @ApiResponse({ status: 200, description: "Seite wurde aktualisiert." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  @ApiResponse({ status: 403, description: "Keine Schreibrechte." })
  @ApiResponse({ status: 404, description: "Seite nicht gefunden." })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePageSchema)) dto: UpdatePageDto,
  ) {
    const data = await this.pagesService.update(id, dto, { actor: user });
    await this.audit.log(
      user.id,
      "page.updated",
      "page",
      data.id,
      { title: data.title, changeMessage: dto.changeMessage ?? null },
      ip,
    );
    this.notifications.notifyPageUpdated(
      { id: data.id, title: data.title, slug: data.slug },
      user,
    );
    return { success: true, data };
  }

  /** Seite löschen. */
  @Delete(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "delete")
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: "Seite löschen" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  @ApiResponse({ status: 200, description: "Seite wurde gelöscht." })
  @ApiResponse({ status: 401, description: "Nicht authentifiziert." })
  @ApiResponse({ status: 403, description: "Keine Schreibrechte." })
  @ApiResponse({ status: 404, description: "Seite nicht gefunden." })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
  ) {
    const deleted = await this.pagesService.remove(id, user.id, user);
    await this.audit.log(
      user.id,
      "page.deleted",
      "page",
      deleted.id,
      { title: deleted.title, slug: deleted.slug },
      ip,
    );
    this.notifications.notifyPageDeleted(deleted.title, user);
    return { success: true, data: null };
  }

  @Post(":id/restore")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "update")
  @ApiBearerAuth()
  async restore(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const data = await this.pagesService.restore(id, user);
    await this.audit.log(user.id, "page.restored", "page", id, { title: data.title });
    this.notifications.notifyPageCreated({ id: data.id, title: data.title, slug: data.slug, type: data.type }, user);
    return { success: true, data };
  }

  @Delete(":id/permanent")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "purge")
  @ApiBearerAuth()
  @HttpCode(200)
  async permanentRemove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const deleted = await this.pagesService.permanentRemove(id, user);
    await this.audit.log(user.id, "page.deleted", "page", id, { title: deleted.title, permanent: true });
    return { success: true, data: null };
  }
}
