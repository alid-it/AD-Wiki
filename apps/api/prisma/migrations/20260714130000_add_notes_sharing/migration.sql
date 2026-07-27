-- Ein frÃ¼her, fehlgeschlagener lokaler Versuch kann die Typen/Tabellen bereits
-- ohne Constraints angelegt haben. Da diese Migration noch nie erfolgreich war,
-- werden ausschlieÃŸlich ihre eigenen leeren Artefakte idempotent bereinigt.
DROP TABLE IF EXISTS "tags_on_notes" CASCADE;
DROP TABLE IF EXISTS "note_shares" CASCADE;
DROP TABLE IF EXISTS "notes" CASCADE;
DROP TYPE IF EXISTS "KnowledgeSensitivity";
DROP TYPE IF EXISTS "KnowledgeKind";
DROP TYPE IF EXISTS "NoteSharePermission";
DROP TYPE IF EXISTS "NoteStatus";

CREATE TYPE "NoteStatus" AS ENUM ('CAPTURED', 'PROMOTED', 'ARCHIVED');
CREATE TYPE "NoteSharePermission" AS ENUM ('VIEW', 'EDIT');
CREATE TYPE "KnowledgeKind" AS ENUM ('NOTE', 'WIKI', 'STANDARD');
CREATE TYPE "KnowledgeSensitivity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "notes" (
  "id" TEXT NOT NULL,
  "title" TEXT,
  "content" TEXT NOT NULL,
  "status" "NoteStatus" NOT NULL DEFAULT 'CAPTURED',
  "mcp_visible" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "owner_id" TEXT NOT NULL,
  "category_id" TEXT,
  "promoted_page_id" TEXT,
  "suggestedType" "KnowledgeKind",
  "classification_confidence" DOUBLE PRECISION,
  "classification_reason" TEXT,
  "quality_score" DOUBLE PRECISION,
  "maturity_score" DOUBLE PRECISION,
  "sensitivity" "KnowledgeSensitivity",
  "assessed_at" TIMESTAMP(3),
  CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "note_shares" (
  "note_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "permission" "NoteSharePermission" NOT NULL DEFAULT 'VIEW',
  "shared_by" TEXT NOT NULL,
  "shared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "note_shares_pkey" PRIMARY KEY ("note_id", "user_id")
);

CREATE TABLE "tags_on_notes" (
  "note_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  CONSTRAINT "tags_on_notes_pkey" PRIMARY KEY ("note_id", "tag_id")
);

CREATE INDEX "notes_owner_id_updated_at_idx" ON "notes"("owner_id", "updated_at");
CREATE INDEX "notes_status_deleted_at_idx" ON "notes"("status", "deleted_at");
CREATE INDEX "note_shares_user_id_idx" ON "note_shares"("user_id");

ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notes" ADD CONSTRAINT "notes_promoted_page_id_fkey" FOREIGN KEY ("promoted_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "note_shares" ADD CONSTRAINT "note_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags_on_notes" ADD CONSTRAINT "tags_on_notes_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags_on_notes" ADD CONSTRAINT "tags_on_notes_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
