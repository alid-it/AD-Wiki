ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "deleted_by" TEXT;
ALTER TABLE "pages" ALTER COLUMN "deleted_by" TYPE TEXT USING "deleted_by"::TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pages_deleted_by_fkey') THEN
    ALTER TABLE "pages" ADD CONSTRAINT "pages_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX "pages_deleted_at_idx" ON "pages"("deleted_at");
