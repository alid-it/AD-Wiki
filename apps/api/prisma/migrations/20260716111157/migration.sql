-- DropIndex
DROP INDEX "notes_knowledge_priority_idx";

-- DropIndex
DROP INDEX "pages_deleted_at_idx";

-- DropIndex
DROP INDEX "pages_knowledge_priority_idx";

-- DropIndex
DROP INDEX "standards_knowledge_priority_idx";

-- RenameIndex
ALTER INDEX "external_item_mappings_connection_id_local_resource_type_local_" RENAME TO "external_item_mappings_connection_id_local_resource_type_lo_key";

-- RenameIndex
ALTER INDEX "external_item_mappings_local_resource_type_local_resource_id_id" RENAME TO "external_item_mappings_local_resource_type_local_resource_i_idx";
