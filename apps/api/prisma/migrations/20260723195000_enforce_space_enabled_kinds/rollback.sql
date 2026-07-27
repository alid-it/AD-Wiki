-- Dokumentierter Rollback. Prisma führt diese Datei nicht automatisch aus.
ALTER TABLE "knowledge_spaces"
DROP CONSTRAINT IF EXISTS "knowledge_spaces_enabled_kinds_not_empty";

ALTER TABLE "knowledge_spaces"
ALTER COLUMN "enabled_kinds" DROP NOT NULL;
