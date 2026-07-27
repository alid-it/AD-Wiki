-- Phase 11D: Verknüpft einen Restore-Download mit dem ursprünglichen
-- externen Backup-Auftrag, ohne Zugangsdaten oder Remote-Pfade zu duplizieren.
ALTER TABLE "backup_jobs"
ADD COLUMN IF NOT EXISTS "source_job_id" TEXT;

-- Ein abgebrochener erster Deploy-Versuch kann die Spalte bereits als UUID
-- hinterlassen haben. Die Migration bleibt deshalb sicher wiederanlaufbar.
ALTER TABLE "backup_jobs"
ALTER COLUMN "source_job_id" TYPE TEXT USING "source_job_id"::TEXT;

ALTER TABLE "backup_jobs"
DROP CONSTRAINT IF EXISTS "backup_jobs_source_job_id_fkey";

ALTER TABLE "backup_jobs"
ADD CONSTRAINT "backup_jobs_source_job_id_fkey"
FOREIGN KEY ("source_job_id") REFERENCES "backup_jobs"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "backup_jobs_source_job_id_idx"
ON "backup_jobs"("source_job_id");
