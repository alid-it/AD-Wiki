-- CreateEnum
CREATE TYPE "BackupDestinationType" AS ENUM ('LOCAL', 'SFTP', 'S3', 'SMB', 'NFS', 'FTPS');

-- CreateEnum
CREATE TYPE "BackupJobOperation" AS ENUM ('BACKUP', 'VERIFY', 'CONNECTION_TEST', 'RESTORE_PREFLIGHT');

-- CreateEnum
CREATE TYPE "BackupJobTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "backup_destinations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BackupDestinationType" NOT NULL,
    "config" JSONB NOT NULL,
    "encrypted_credentials" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_tested_at" TIMESTAMP(3),
    "last_test_succeeded" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "backup_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_hour" INTEGER NOT NULL,
    "schedule_minute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[],
    "retention_daily" INTEGER NOT NULL DEFAULT 7,
    "retention_weekly" INTEGER NOT NULL DEFAULT 4,
    "retention_monthly" INTEGER NOT NULL DEFAULT 6,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "destination_id" TEXT NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "backup_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "operation" "BackupJobOperation" NOT NULL DEFAULT 'BACKUP',
    "trigger" "BackupJobTrigger" NOT NULL DEFAULT 'MANUAL',
    "status" "BackupJobStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "artifact_path" TEXT,
    "artifact_size" BIGINT,
    "checksum" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plan_id" TEXT,
    "destination_id" TEXT,
    "requested_by_id" TEXT,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "backup_destinations_name_key" ON "backup_destinations"("name");

-- CreateIndex
CREATE INDEX "backup_destinations_type_is_enabled_idx" ON "backup_destinations"("type", "is_enabled");

-- CreateIndex
CREATE UNIQUE INDEX "backup_plans_name_key" ON "backup_plans"("name");

-- CreateIndex
CREATE INDEX "backup_plans_enabled_next_run_at_idx" ON "backup_plans"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "backup_plans_destination_id_idx" ON "backup_plans"("destination_id");

-- CreateIndex
CREATE INDEX "backup_jobs_status_created_at_idx" ON "backup_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "backup_jobs_destination_id_created_at_idx" ON "backup_jobs"("destination_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_jobs_plan_id_scheduled_for_key" ON "backup_jobs"("plan_id", "scheduled_for");

-- AddForeignKey
ALTER TABLE "backup_destinations" ADD CONSTRAINT "backup_destinations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_plans" ADD CONSTRAINT "backup_plans_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_plans" ADD CONSTRAINT "backup_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "backup_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "backup_destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
