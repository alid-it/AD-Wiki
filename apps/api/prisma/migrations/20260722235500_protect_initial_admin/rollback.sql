-- Dokumentierter Rollback. Prisma fuehrt diese Datei nicht automatisch aus.
DROP INDEX IF EXISTS "users_single_protected_account";
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_protected";
