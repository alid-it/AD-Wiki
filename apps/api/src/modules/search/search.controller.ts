import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GlobalSearchQuerySchema, SearchQuerySchema } from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { SearchService } from "@/modules/search/search.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import type { GlobalSearchQuery, SearchQuery } from "@ad-wiki/shared-types";

/** REST-Endpunkt für die Volltextsuche über Seiten. */
@ApiTags("Search")
@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** Benutzerbezogene Suche über alle für den Benutzer sichtbaren Quellen. */
  @Get("global")
  @UseGuards(JwtOrApiKeyGuard)
  @ApiOperation({ summary: "Globale Suche über alle sichtbaren Wissensquellen" })
  @ApiQuery({ name: "q", description: "Suchbegriff", example: "dns" })
  @ApiQuery({ name: "types", required: false, example: "pages,notes,standards,media" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiResponse({ status: 200, description: "Nach Relevanz sortierte, sichtbare Treffer." })
  @ApiResponse({ status: 401, description: "Anmeldung erforderlich." })
  async globalSearch(
    @Query(new ZodValidationPipe(GlobalSearchQuerySchema)) query: GlobalSearchQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { data, meta } = await this.searchService.globalSearch(query, user);
    return { success: true, data, meta };
  }

  /** Durchsucht veröffentlichte Seiten nach dem Suchbegriff. */
  @Get()
  @ApiOperation({ summary: "Veröffentlichte Seiten durchsuchen" })
  @ApiQuery({ name: "q", description: "Suchbegriff", example: "dns" })
  @ApiQuery({ name: "page", required: false, example: 1 })
  @ApiQuery({ name: "limit", required: false, example: 20 })
  @ApiResponse({ status: 200, description: "Nach Relevanz sortierte Treffer." })
  @ApiResponse({ status: 400, description: "Ungültige Suchparameter." })
  async search(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: SearchQuery,
  ) {
    const { data, meta } = await this.searchService.search(query);
    return { success: true, data, meta };
  }
}
