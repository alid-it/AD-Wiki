import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { BackupWorkerModule } from "@/backup-worker/backup-worker.module";
import { BackupJobWorkerService } from "@/backup-worker/backup-job-worker.service";
import { createApplicationLogger } from "@/common/logging/structured-logger";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(BackupWorkerModule, {
    logger: createApplicationLogger(),
  });
  const worker = app.get(BackupJobWorkerService);
  const shutdown = (): void => worker.stop();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await worker.runForever();
  } finally {
    await app.close();
  }
}

void bootstrap();
