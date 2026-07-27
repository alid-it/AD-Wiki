import { Controller, Get, Ip, Param, Query, Res, StreamableFile, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { BulkExportQuerySchema, type BulkExportQuery } from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { AuditService } from "@/modules/audit/audit.service";
import { ExportService } from "@/modules/export/export.service";

interface DownloadArtifact {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  itemCount?: number;
}

@ApiTags("Export")
@ApiBearerAuth()
@Controller()
export class ExportController {
  constructor(
    private readonly exports: ExportService,
    private readonly audit: AuditService,
  ) {}

  @Get("pages/:id/export/pdf")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiOperation({ summary: "Wiki-Seite als PDF exportieren" })
  @ApiParam({ name: "id", description: "UUID der Seite" })
  async pagePdf(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    return this.download(await this.exports.exportPagePdf(id, user), response);
  }

  @Get("pages/:id/export/markdown")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiOperation({ summary: "Wiki-Seite mit YAML-Frontmatter als Markdown exportieren" })
  async pageMarkdown(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    return this.download(await this.exports.exportPageMarkdown(id, user), response);
  }

  @Get("categories/:id/export/pdf")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiOperation({ summary: "Wiki-Kategorie als gemeinsames PDF exportieren" })
  async categoryPdf(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    return this.download(await this.exports.exportCategoryPdf(id, user), response);
  }

  @Get("categories/:id/export/markdown")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("pages", "read")
  @ApiOperation({ summary: "Wiki-Kategorie als Markdown-ZIP exportieren" })
  async categoryMarkdown(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    return this.download(await this.exports.exportCategoryMarkdown(id, user), response);
  }

  @Get("export/wiki")
  @UseGuards(JwtOrApiKeyGuard, AclGuard)
  @RequirePermission("exports", "run")
  @ApiOperation({ summary: "Vollständiges Wiki inklusive Notizen, Richtlinien und Medien exportieren" })
  @ApiQuery({ name: "format", enum: ["markdown", "html", "pdf"], required: false })
  async wiki(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Query(new ZodValidationPipe(BulkExportQuerySchema)) query: BulkExportQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const artifact = await this.exports.exportWiki(query.format, user);
    await this.audit.log(user.id, "export.wiki", "export", null, {
      format: query.format,
      filename: artifact.filename,
      itemCount: artifact.itemCount,
      bytes: artifact.buffer.length,
    }, ip);
    return this.download(artifact, response);
  }

  private download(artifact: DownloadArtifact, response: Response) {
    const asciiName = artifact.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    response.setHeader("Content-Type", artifact.mimeType);
    response.setHeader("Content-Length", String(artifact.buffer.length));
    response.setHeader("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`);
    response.setHeader("X-Export-Items", String(artifact.itemCount ?? 1));
    return new StreamableFile(artifact.buffer);
  }
}
