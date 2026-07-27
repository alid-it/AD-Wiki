import { Module } from "@nestjs/common";
import { BackupEncryptionService } from "@/modules/backups/backup-encryption.service";
import { BackupsController } from "@/modules/backups/backups.controller";
import { BackupsService } from "@/modules/backups/backups.service";
import { BackupSchedulerService } from "@/modules/backups/backup-scheduler.service";

@Module({
  controllers: [BackupsController],
  providers: [BackupEncryptionService, BackupsService, BackupSchedulerService],
  exports: [BackupEncryptionService, BackupsService],
})
export class BackupsModule {}
