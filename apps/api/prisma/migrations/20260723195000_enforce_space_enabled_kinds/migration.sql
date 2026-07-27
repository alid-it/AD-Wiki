-- Prisma 7 erzeugt für Enum-Arrays nicht in jeder Umgebung automatisch die
-- fachlich erwartete NOT-NULL-Constraint. KnowledgeSpace verlangt mindestens
-- einen aktivierten Inhaltstyp; die Datenbank bildet diese Pflicht ebenfalls ab.
UPDATE "knowledge_spaces"
SET "enabled_kinds" = ARRAY['WIKI']::"KnowledgeKind"[]
WHERE "enabled_kinds" IS NULL;

ALTER TABLE "knowledge_spaces"
ALTER COLUMN "enabled_kinds" SET NOT NULL;

ALTER TABLE "knowledge_spaces"
ADD CONSTRAINT "knowledge_spaces_enabled_kinds_not_empty"
CHECK (cardinality("enabled_kinds") > 0);
