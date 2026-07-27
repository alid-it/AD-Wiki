-- Phase 11E: Speichert nur das redigierte Ergebnis der Restore-Vorpruefung.
-- Zugangsdaten oder andere Geheimnisse werden in diesem JSON nie abgelegt.
ALTER TABLE "backup_jobs"
ADD COLUMN IF NOT EXISTS "restore_preflight" JSONB;
