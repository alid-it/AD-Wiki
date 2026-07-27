-- Dokumentierter Rollback. Prisma führt diese Datei nicht automatisch aus.
-- Vor dem Rollback müssen gleichnamige Kategorien aus verschiedenen Bereichen
-- zusammengeführt werden, damit die alten globalen Unique-Indizes wieder gelten.
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_space_id_fkey";
ALTER TABLE "pages" DROP CONSTRAINT IF EXISTS "pages_space_id_fkey";
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_space_id_fkey";
ALTER TABLE "standards" DROP CONSTRAINT IF EXISTS "standards_space_id_fkey";

DROP INDEX IF EXISTS "categories_space_id_scope_name_key";
DROP INDEX IF EXISTS "categories_space_id_scope_slug_key";

CREATE UNIQUE INDEX "categories_scope_name_key" ON "categories"("scope", "name");
CREATE UNIQUE INDEX "categories_scope_slug_key" ON "categories"("scope", "slug");

ALTER TABLE "categories" DROP COLUMN IF EXISTS "space_id";
ALTER TABLE "pages" DROP COLUMN IF EXISTS "space_id";
ALTER TABLE "notes" DROP COLUMN IF EXISTS "space_id";
ALTER TABLE "standards" DROP COLUMN IF EXISTS "space_id";

DROP TABLE IF EXISTS "knowledge_spaces";
DROP TYPE IF EXISTS "SpaceVisibility";
