CREATE TYPE "CategoryScope" AS ENUM ('WIKI', 'NOTE', 'STANDARD');

ALTER TABLE "categories"
ADD COLUMN "scope" "CategoryScope" NOT NULL DEFAULT 'WIKI';

DROP INDEX "categories_name_key";
DROP INDEX "categories_slug_key";

CREATE UNIQUE INDEX "categories_scope_name_key" ON "categories"("scope", "name");
CREATE UNIQUE INDEX "categories_scope_slug_key" ON "categories"("scope", "slug");

-- Bestehende Notiz-Zuordnungen werden in eigene Notiz-Kategorien kopiert.
-- Dadurch bleiben Namen, Tags und Zuordnungen erhalten, ohne Wiki-Kategorien
-- und Notiz-Kategorien weiterhin fachlich zu vermischen.
CREATE TEMP TABLE "note_category_scope_map" (
  "old_id" TEXT PRIMARY KEY,
  "new_id" TEXT NOT NULL
);

INSERT INTO "note_category_scope_map" ("old_id", "new_id")
SELECT DISTINCT c."id", gen_random_uuid()::text
FROM "categories" c
INNER JOIN "notes" n ON n."category_id" = c."id";

INSERT INTO "categories" (
  "id", "name", "slug", "scope", "description", "icon", "sort_order", "created_at"
)
SELECT
  mapping."new_id", c."name", c."slug", 'NOTE', c."description", c."icon", c."sort_order", c."created_at"
FROM "note_category_scope_map" mapping
INNER JOIN "categories" c ON c."id" = mapping."old_id";

UPDATE "notes" n
SET "category_id" = mapping."new_id"
FROM "note_category_scope_map" mapping
WHERE n."category_id" = mapping."old_id";
