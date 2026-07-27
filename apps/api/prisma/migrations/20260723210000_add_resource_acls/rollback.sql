-- Dokumentierter Rollback. Prisma führt diese Datei nicht automatisch aus.
DROP TABLE IF EXISTS "resource_acl_boundaries";
DROP TABLE IF EXISTS "resource_acl_entries";
DROP TYPE IF EXISTS "ResourceAclEffect";
