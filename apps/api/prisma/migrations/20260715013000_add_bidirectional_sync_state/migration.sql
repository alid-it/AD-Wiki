-- Bidirectional note/task synchronization snapshots and additional run counts.
ALTER TABLE "external_item_mappings"
    ADD COLUMN "last_local_hash" TEXT,
    ADD COLUMN "last_external_hash" TEXT,
    ADD COLUMN "local_updated_at" TIMESTAMP(3),
    ADD COLUMN "external_updated_at" TIMESTAMP(3),
    ADD COLUMN "detached_at" TIMESTAMP(3),
    ADD COLUMN "external_deleted_at" TIMESTAMP(3);

ALTER TABLE "integration_sync_runs"
    ADD COLUMN "updated_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deleted_count" INTEGER NOT NULL DEFAULT 0;
