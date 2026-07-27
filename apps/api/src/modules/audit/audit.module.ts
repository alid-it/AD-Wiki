import { Global, Module } from "@nestjs/common";
import { AuditController } from "@/modules/audit/audit.controller";
import { AuditService } from "@/modules/audit/audit.service";
import { HealthModule } from "@/health/health.module";

/**
 * Globales Audit-Modul. Durch @Global ist der {@link AuditService} in allen
 * Feature-Modulen ohne erneuten Import injizierbar, sodass beliebige Services
 * und Controller Ereignisse protokollieren können.
 */
@Global()
@Module({
  imports: [HealthModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
