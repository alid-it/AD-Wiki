import { Module } from "@nestjs/common";
import { BackupJobWorkerService } from "@/backup-worker/backup-job-worker.service";
import { PrismaModule } from "@/prisma/prisma.module";
import { BackupCoordinationModule } from "@/modules/backups/backup-coordination.module";
import { BackupEncryptionService } from "@/modules/backups/backup-encryption.service";
import { BackupStorageService } from "@/modules/backups/backup-storage.service";

@Module({
  imports: [PrismaModule, BackupCoordinationModule],
  providers: [BackupEncryptionService, BackupStorageService, BackupJobWorkerService],
  exports: [BackupJobWorkerService],
})
export class BackupWorkerModule {}
