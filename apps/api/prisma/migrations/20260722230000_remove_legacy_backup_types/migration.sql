-- Die entfernten Zieltypen dürfen nicht stillschweigend umgedeutet werden.
-- Gemountete Verzeichnisse werden künftig einheitlich als LOCAL mit einem
-- freigegebenen mountName (local oder network) gespeichert.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "backup_destinations"
    WHERE "type" IN ('SMB', 'NFS', 'FTPS')
  ) THEN
    RAISE EXCEPTION 'Migration abgebrochen: Vor dem Entfernen von SMB, NFS und FTPS müssen bestehende Ziele gelöscht oder als LOCAL neu angelegt werden.';
  END IF;
END $$;

ALTER TYPE "BackupDestinationType" RENAME TO "BackupDestinationType_legacy";
CREATE TYPE "BackupDestinationType" AS ENUM ('LOCAL', 'SFTP', 'S3');

ALTER TABLE "backup_destinations"
ALTER COLUMN "type" TYPE "BackupDestinationType"
USING ("type"::text::"BackupDestinationType");

DROP TYPE "BackupDestinationType_legacy";
