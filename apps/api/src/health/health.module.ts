import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { MonitoringService } from "./monitoring.service";

/** Modul für den Health-Check der API. */
@Module({
  controllers: [HealthController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class HealthModule {}
