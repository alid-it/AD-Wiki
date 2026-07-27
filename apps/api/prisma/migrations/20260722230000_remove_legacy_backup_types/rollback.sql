-- Dokumentierter Rollback. Prisma führt diese Datei nicht automatisch aus.
-- Alle Werte des reduzierten Enums sind auch im ursprünglichen Enum enthalten.

ALTER TYPE "BackupDestinationType" RENAME TO "BackupDestinationType_reduced";
CREATE TYPE "BackupDestinationType" AS ENUM ('LOCAL', 'SFTP', 'S3', 'SMB', 'NFS', 'FTPS');

ALTER TABLE "backup_destinations"
ALTER COLUMN "type" TYPE "BackupDestinationType"
USING ("type"::text::"BackupDestinationType");

DROP TYPE "BackupDestinationType_reduced";
