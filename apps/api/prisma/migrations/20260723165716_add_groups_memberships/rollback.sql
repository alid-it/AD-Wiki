-- Dokumentierter Rollback. Prisma führt diese Datei nicht automatisch aus.
DROP TABLE IF EXISTS "group_memberships";
DROP TABLE IF EXISTS "groups";
DROP TYPE IF EXISTS "GroupMembershipRole";
