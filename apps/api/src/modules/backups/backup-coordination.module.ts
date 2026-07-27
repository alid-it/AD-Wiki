import { Global, Module } from "@nestjs/common";
import { BackupCoordinationService } from "@/modules/backups/backup-coordination.service";

@Global()
@Module({
  providers: [BackupCoordinationService],
  exports: [BackupCoordinationService],
})
export class BackupCoordinationModule {}
