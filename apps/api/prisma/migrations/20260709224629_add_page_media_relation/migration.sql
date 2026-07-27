-- CreateTable
CREATE TABLE "page_media" (
    "page_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_media_pkey" PRIMARY KEY ("page_id","media_id")
);

-- AddForeignKey
ALTER TABLE "page_media" ADD CONSTRAINT "page_media_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_media" ADD CONSTRAINT "page_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
