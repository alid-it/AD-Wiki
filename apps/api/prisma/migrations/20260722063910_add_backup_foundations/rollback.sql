-- Dokumentierter Rollback für Phase 11A.
-- Nur anwenden, solange keine aufzubewahrenden Backup-Konfigurationen oder
-- Jobhistorien existieren. Prisma führt diese Datei nicht automatisch aus.

DROP TABLE IF EXISTS "backup_jobs";
DROP TABLE IF EXISTS "backup_plans";
DROP TABLE IF EXISTS "backup_destinations";

DROP TYPE IF EXISTS "BackupJobStatus";
DROP TYPE IF EXISTS "BackupJobTrigger";
DROP TYPE IF EXISTS "BackupJobOperation";
DROP TYPE IF EXISTS "BackupDestinationType";
