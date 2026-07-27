-- Dokumentierter Rollback für Phase 11D.
DROP INDEX IF EXISTS "backup_jobs_source_job_id_idx";

ALTER TABLE "backup_jobs"
DROP CONSTRAINT IF EXISTS "backup_jobs_source_job_id_fkey";

ALTER TABLE "backup_jobs"
DROP COLUMN IF EXISTS "source_job_id";
