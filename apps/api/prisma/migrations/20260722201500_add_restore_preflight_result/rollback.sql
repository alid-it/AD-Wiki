-- Dokumentierter Rollback fuer Phase 11E.
ALTER TABLE "backup_jobs"
DROP COLUMN IF EXISTS "restore_preflight";
