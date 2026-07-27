-- Phase 9e extension: distinguish imports from exports and ensure that one
-- local resource is linked at most once per integration connection.
CREATE TYPE "ExternalItemSyncDirection" AS ENUM ('IMPORT', 'EXPORT');

ALTER TABLE "external_item_mappings"
    ADD COLUMN "direction" "ExternalItemSyncDirection" NOT NULL DEFAULT 'IMPORT';

CREATE UNIQUE INDEX "external_item_mappings_connection_id_local_resource_type_local_resource_id_key"
    ON "external_item_mappings"("connection_id", "local_resource_type", "local_resource_id");
