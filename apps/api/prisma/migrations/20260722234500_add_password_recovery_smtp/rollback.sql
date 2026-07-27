-- Dokumentierter Rollback. Prisma führt diese Datei nicht automatisch aus.
DROP TABLE IF EXISTS "password_reset_tokens";
DROP TABLE IF EXISTS "smtp_configurations";
