import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  CreateBackupDestinationSchema,
  CreateBackupPlanSchema,
  StartBackupJobSchema,
  UpdateBackupDestinationSchema,
  UpdateBackupPlanSchema,
  type CreateBackupDestinationInput,
  type CreateBackupPlanInput,
  type StartBackupJobInput,
  type UpdateBackupDestinationInput,
  type UpdateBackupPlanInput,
} from "@ad-wiki/shared-types";
import { ZodValidationPipe } from "@/common/pipes/zod-validation.pipe";
import { JwtOrApiKeyGuard } from "@/modules/api-keys/guards/jwt-or-api-key.guard";
import { AuditService } from "@/modules/audit/audit.service";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { RequirePermission } from "@/modules/auth/decorators/require-permission.decorator";
import { AclGuard } from "@/modules/auth/guards/acl.guard";
import type { AuthenticatedUser } from "@/modules/auth/types/jwt-payload";
import { BackupsService } from "@/modules/backups/backups.service";

@ApiTags("Backups")
@ApiBearerAuth()
@Controller("backups")
@UseGuards(JwtOrApiKeyGuard, AclGuard)
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly audit: AuditService,
  ) {}

  @Get("destinations")
  @RequirePermission("backups", "read")
  @ApiOperation({ summary: "Konfigurierte Backup-Ziele sicher auflisten" })
  async listDestinations() {
    return { success: true, data: await this.backups.listDestinations() };
  }

  @Post("destinations")
  @RequirePermission("backups", "create")
  @ApiOperation({ summary: "Backup-Ziel mit verschlüsselten Zugangsdaten anlegen" })
  async createDestination(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateBackupDestinationSchema)) input: CreateBackupDestinationInput,
  ) {
    const data = await this.backups.createDestination(user.id, input);
    await this.audit.log(user.id, "backup_destination.created", "backup_destination", data.id, {
      name: data.name,
      type: data.type,
      isEnabled: data.isEnabled,
    }, ip);
    return { success: true, data };
  }

  @Patch("destinations/:id")
  @RequirePermission("backups", "update")
  @ApiOperation({ summary: "Backup-Ziel aktualisieren" })
  async updateDestination(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBackupDestinationSchema)) input: UpdateBackupDestinationInput,
  ) {
    const data = await this.backups.updateDestination(id, input);
    await this.audit.log(user.id, "backup_destination.updated", "backup_destination", data.id, {
      name: data.name,
      type: data.type,
      changedFields: Object.keys(input).sort(),
    }, ip);
    return { success: true, data };
  }

  @Delete("destinations/:id")
  @RequirePermission("backups", "delete")
  @ApiOperation({ summary: "Nicht verwendetes Backup-Ziel löschen" })
  async deleteDestination(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.backups.deleteDestination(id);
    await this.audit.log(user.id, "backup_destination.deleted", "backup_destination", data.id, {
      name: data.name,
      type: data.type,
    }, ip);
    return { success: true, data };
  }

  @Post("destinations/:id/test")
  @RequirePermission("backups", "update")
  @ApiOperation({ summary: "Asynchronen, sicheren Verbindungstest starten" })
  async testDestination(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.backups.startConnectionTest(user.id, id);
    await this.audit.log(user.id, "backup_job.started", "backup_job", data.id, {
      operation: data.operation,
      destinationId: data.destinationId,
      status: data.status,
    }, ip);
    return { success: true, data };
  }

  @Get("plans")
  @RequirePermission("backups", "read")
  @ApiOperation({ summary: "Backup-Zeitpläne auflisten" })
  async listPlans() {
    return { success: true, data: await this.backups.listPlans() };
  }

  @Post("plans")
  @RequirePermission("backups", "create")
  @ApiOperation({ summary: "Strukturierten Backup-Zeitplan anlegen" })
  async createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(CreateBackupPlanSchema)) input: CreateBackupPlanInput,
  ) {
    const data = await this.backups.createPlan(user.id, input);
    await this.audit.log(user.id, "backup_plan.created", "backup_plan", data.id, {
      name: data.name,
      destinationId: data.destination.id,
      enabled: data.enabled,
    }, ip);
    return { success: true, data };
  }

  @Patch("plans/:id")
  @RequirePermission("backups", "update")
  @ApiOperation({ summary: "Backup-Zeitplan aktualisieren" })
  async updatePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateBackupPlanSchema)) input: UpdateBackupPlanInput,
  ) {
    const data = await this.backups.updatePlan(id, input);
    await this.audit.log(user.id, "backup_plan.updated", "backup_plan", data.id, {
      name: data.name,
      changedFields: Object.keys(input).sort(),
    }, ip);
    return { success: true, data };
  }

  @Delete("plans/:id")
  @RequirePermission("backups", "delete")
  @ApiOperation({ summary: "Backup-Zeitplan löschen" })
  async deletePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.backups.deletePlan(id);
    await this.audit.log(user.id, "backup_plan.deleted", "backup_plan", data.id, {
      name: data.name,
    }, ip);
    return { success: true, data };
  }

  @Get("jobs")
  @RequirePermission("backups", "read")
  @ApiOperation({ summary: "Letzte Backup-Aufträge auflisten" })
  async listJobs() {
    return { success: true, data: await this.backups.listJobs() };
  }

  @Get("overview")
  @RequirePermission("backups", "read")
  @ApiOperation({ summary: "Backup-Status und naechste Ausfuehrung abrufen" })
  async overview() {
    return { success: true, data: await this.backups.overview() };
  }

  @Get("jobs/:id")
  @RequirePermission("backups", "read")
  @ApiOperation({ summary: "Status eines Backup-Auftrags abrufen" })
  async getJob(@Param("id", new ParseUUIDPipe()) id: string) {
    return { success: true, data: await this.backups.getJob(id) };
  }

  @Post("jobs")
  @RequirePermission("backups", "run")
  @ApiOperation({ summary: "Backup für ein konfiguriertes Ziel manuell anstoßen" })
  async startBackup(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Body(new ZodValidationPipe(StartBackupJobSchema)) input: StartBackupJobInput,
  ) {
    const data = await this.backups.startBackupJob(user.id, input);
    await this.audit.log(user.id, "backup_job.started", "backup_job", data.id, {
      destinationId: data.destinationId,
      planId: data.planId,
      trigger: data.trigger,
      status: data.status,
    }, ip);
    return { success: true, data };
  }

  @Post("jobs/:id/restore-preflight")
  @RequirePermission("backups", "restore")
  @ApiOperation({ summary: "Externes Backup geprüft in das lokale Restore-Ziel laden" })
  async prepareRestore(
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.backups.prepareRestore(user.id, id);
    await this.audit.log(user.id, "backup_job.started", "backup_job", data.id, {
      operation: data.operation,
      destinationId: data.destinationId,
      sourceJobId: data.sourceJobId,
      status: data.status,
    }, ip);
    return { success: true, data };
  }

  @Get("jobs/:id/restore-runbook")
  @RequirePermission("backups", "restore")
  @ApiOperation({ summary: "Geprüfte Restore-Schritte für einen Vorprüfungsauftrag abrufen" })
  async getRestoreRunbook(@Param("id", new ParseUUIDPipe()) id: string) {
    return { success: true, data: await this.backups.getRestoreRunbook(id) };
  }
}
