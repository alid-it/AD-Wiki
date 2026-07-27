ALTER TABLE "pages"
ADD COLUMN IF NOT EXISTS "mcp_visible" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "page_links" (
  "id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  CONSTRAINT "page_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "page_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "page_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "page_links_source_id_target_id_key" ON "page_links"("source_id", "target_id");
CREATE INDEX IF NOT EXISTS "page_links_target_id_idx" ON "page_links"("target_id");
