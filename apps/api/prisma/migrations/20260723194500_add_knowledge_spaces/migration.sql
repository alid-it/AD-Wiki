-- CreateEnum
CREATE TYPE "SpaceVisibility" AS ENUM ('OPEN', 'RESTRICTED');

-- CreateTable
CREATE TABLE "knowledge_spaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "SpaceVisibility" NOT NULL DEFAULT 'OPEN',
    "enabled_kinds" "KnowledgeKind"[] DEFAULT ARRAY['WIKI']::"KnowledgeKind"[],
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "responsible_group_id" TEXT,

    CONSTRAINT "knowledge_spaces_pkey" PRIMARY KEY ("id")
);

-- AddColumn: zunächst nullable, damit bestehende Inhalte sicher migriert werden.
ALTER TABLE "categories" ADD COLUMN "space_id" TEXT;
ALTER TABLE "notes" ADD COLUMN "space_id" TEXT;
ALTER TABLE "pages" ADD COLUMN "space_id" TEXT;
ALTER TABLE "standards" ADD COLUMN "space_id" TEXT;

-- Offener Systembereich bewahrt das bisherige Zugriffsverhalten.
INSERT INTO "knowledge_spaces" (
    "id",
    "name",
    "slug",
    "description",
    "visibility",
    "enabled_kinds",
    "is_system",
    "updated_at"
) VALUES (
    '00000000-0000-4000-8000-000000000014',
    'Allgemein',
    'allgemein',
    'Offener Standardbereich für bestehende Wissensinhalte',
    'OPEN',
    ARRAY['WIKI', 'NOTE', 'STANDARD']::"KnowledgeKind"[],
    true,
    CURRENT_TIMESTAMP
);

-- Bestehende gemeinsame Inhalte werden dem offenen Standardbereich zugeordnet.
-- Persönliche Notizen bleiben absichtlich ohne Bereich.
UPDATE "categories"
SET "space_id" = '00000000-0000-4000-8000-000000000014'
WHERE "space_id" IS NULL;

UPDATE "pages"
SET "space_id" = '00000000-0000-4000-8000-000000000014'
WHERE "space_id" IS NULL;

UPDATE "standards"
SET "space_id" = '00000000-0000-4000-8000-000000000014'
WHERE "space_id" IS NULL;

ALTER TABLE "categories" ALTER COLUMN "space_id" SET NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "space_id" SET NOT NULL;
ALTER TABLE "standards" ALTER COLUMN "space_id" SET NOT NULL;

-- Category-Namen und -Slugs sind ab jetzt innerhalb eines Bereichs eindeutig.
DROP INDEX "categories_scope_name_key";
DROP INDEX "categories_scope_slug_key";

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_spaces_name_key" ON "knowledge_spaces"("name");
CREATE UNIQUE INDEX "knowledge_spaces_slug_key" ON "knowledge_spaces"("slug");
CREATE INDEX "knowledge_spaces_visibility_idx" ON "knowledge_spaces"("visibility");
CREATE INDEX "knowledge_spaces_responsible_group_id_idx" ON "knowledge_spaces"("responsible_group_id");
CREATE INDEX "categories_space_id_scope_idx" ON "categories"("space_id", "scope");
CREATE UNIQUE INDEX "categories_space_id_scope_name_key" ON "categories"("space_id", "scope", "name");
CREATE UNIQUE INDEX "categories_space_id_scope_slug_key" ON "categories"("space_id", "scope", "slug");
CREATE INDEX "notes_space_id_deleted_at_idx" ON "notes"("space_id", "deleted_at");
CREATE INDEX "pages_space_id_deleted_at_idx" ON "pages"("space_id", "deleted_at");
CREATE INDEX "standards_space_id_idx" ON "standards"("space_id");

-- AddForeignKey
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_responsible_group_id_fkey" FOREIGN KEY ("responsible_group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pages" ADD CONSTRAINT "pages_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standards" ADD CONSTRAINT "standards_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "knowledge_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
