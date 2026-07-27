import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuditLogQuerySchema, type AuditLogQuery } from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AuditService } from "@/modules/audit/audit.service";

/** REST-Endpunkte zum Abfragen des Audit-Logs. */
@ApiTags("Audit")
@Controller("audit-logs")
@UseGuards(JwtOrApiKeyGuard, AclGuard)
@RequirePermission("audit_logs", "read")
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /** Paginierte, filterbare Liste der Audit-Einträge (Admin). */
  @Get()
  @ApiOperation({ summary: "Audit-Log auflisten (paginiert, filterbar) – Admin" })
  @ApiQuery({ name: "resource", required: false, description: "z. B. page, category, user" })
  @ApiQuery({ name: "action", required: false, description: "z. B. page.updated" })
  @ApiQuery({ name: "userId", required: false, description: "UUID des auslösenden Benutzers" })
  @ApiQuery({ name: "from", required: false, description: "ISO-Datum (untere Grenze)" })
  @ApiQuery({ name: "to", required: false, description: "ISO-Datum (obere Grenze)" })
  @ApiQuery({ name: "cursor", required: false, description: "Cursor der nächsten Seite (aus meta.nextCursor)" })
  @ApiQuery({ name: "perPage", required: false, type: Number })
  @ApiResponse({ status: 200, description: "Paginierte Audit-Log-Liste." })
  @ApiResponse({ status: 403, description: "Keine Admin-Rechte." })
  async findAll(
    @Query(new ZodValidationPipe(AuditLogQuerySchema)) query: AuditLogQuery,
  ) {
    const { data, meta } = await this.auditService.findAll(query);
    return { success: true, data, meta };
  }
}
