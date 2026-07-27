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
  Query,
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
import { CategoryScopeSchema, CreateCategorySchema, UpdateCategorySchema } from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { NotificationService } from "@/modules/websocket/notification.service";
import { CategoriesService } from "@/modules/categories/categories.service";
import type { CreateCategoryDto } from "@/modules/categories/dto/create-category.dto";
import type { UpdateCategoryDto } from "@/modules/categories/dto/update-category.dto";

/** REST-Endpunkte zur Verwaltung von Kategorien. */
@ApiTags("Categories")
@Controller("categories")
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Alle Kategorien inklusive Seitenanzahl. */
  @Get()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("categories", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Alle Kategorien mit Seitenanzahl auflisten" })
  @ApiResponse({ status: 200, description: "Liste aller Kategorien." })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query("scope") scope?: string,
    @Query("spaceId") spaceId?: string,
  ) {
    const data = await this.categoriesService.findAll(
      CategoryScopeSchema.catch("wiki").parse(scope),
      spaceId,
      user,
    );
    return { success: true, data };
  }

  /** Einzelne Kategorie samt ihrer Seiten. */
  @Get(":slug")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("categories", "read")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Einzelne Kategorie mit ihren Seiten laden" })
  @ApiParam({ name: "slug", description: "Slug der Kategorie" })
  @ApiResponse({ status: 200, description: "Die gefundene Kategorie." })
  @ApiResponse({ status: 404, description: "Kategorie nicht gefunden." })
  async findBySlug(
    @CurrentUser() user: AuthenticatedUser,
    @Param("slug") slug: string,
    @Query("scope") scope?: string,
    @Query("spaceId") spaceId?: string,
  ) {
    const data = await this.categoriesService.findBySlug(
      slug,
      CategoryScopeSchema.catch("wiki").parse(scope),
      spaceId,
      user,
    );
    return { success: true, data };
  }

  /** Neue Kategorie anlegen. Nur für Redakteure/Admins. */
  @Post()
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("categories", "create")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Neue Kategorie erstellen" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", example: "Technik" },
        description: { type: "string", example: "Alles rund um Technik" },
        icon: { type: "string", example: "cpu" },
        sortOrder: { type: "number", example: 0 },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Kategorie wurde erstellt." })
  @ApiResponse({ status: 400, description: "Ungültige Eingabedaten." })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) dto: CreateCategoryDto,
  ) {
    const data = await this.categoriesService.create(dto, user);
    await this.audit.log(
      user.id,
      "category.created",
      "category",
      data.id,
      { name: data.name, slug: data.slug },
      ip,
    );
    this.notifications.notifyCategoryCreated(
      { id: data.id, name: data.name, slug: data.slug },
      user,
    );
    return { success: true, data };
  }

  /** Bestehende Kategorie bearbeiten. Nur für Redakteure/Admins. */
  @Patch(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("categories", "update")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Kategorie bearbeiten" })
  @ApiParam({ name: "id", description: "UUID der Kategorie" })
  @ApiResponse({ status: 200, description: "Kategorie wurde aktualisiert." })
  @ApiResponse({ status: 404, description: "Kategorie nicht gefunden." })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema)) dto: UpdateCategoryDto,
  ) {
    const data = await this.categoriesService.update(id, dto, user);
    await this.audit.log(
      user.id,
      "category.updated",
      "category",
      data.id,
      { name: data.name, slug: data.slug },
      ip,
    );
    this.notifications.notifyCategoryUpdated(
      { id: data.id, name: data.name, slug: data.slug },
      user,
    );
    return { success: true, data };
  }

  /** Kategorie löschen. Nur für Redakteure/Admins. */
  @Delete(":id")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("categories", "delete")
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: "Kategorie löschen" })
  @ApiParam({ name: "id", description: "UUID der Kategorie" })
  @ApiResponse({ status: 200, description: "Kategorie wurde gelöscht." })
  @ApiResponse({ status: 404, description: "Kategorie nicht gefunden." })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id") id: string,
  ) {
    const deleted = await this.categoriesService.remove(id, user);
    await this.audit.log(
      user.id,
      "category.deleted",
      "category",
      deleted.id,
      { name: deleted.name, slug: deleted.slug },
      ip,
    );
    this.notifications.notifyCategoryDeleted(deleted.name, user);
    return { success: true, data: null };
  }
}
