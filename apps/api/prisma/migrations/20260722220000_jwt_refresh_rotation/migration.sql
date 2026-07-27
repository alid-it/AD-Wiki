-- Bestehende Web-Refresh-Tokens werden vor der Spaltenumbenennung irreversibel
-- mit SHA-256 gehasht. PostgreSQL stellt sha256(bytea) ohne Erweiterung bereit.
UPDATE "sessions"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');

ALTER TABLE "sessions" RENAME COLUMN "token" TO "token_hash";
ALTER INDEX "sessions_token_key" RENAME TO "sessions_token_hash_key";

ALTER TABLE "sessions"
ADD COLUMN "family_id" TEXT,
ADD COLUMN "rotated_at" TIMESTAMP(3),
ADD COLUMN "revoked_at" TIMESTAMP(3);

-- Jede bereits vorhandene Sitzung beginnt als eigene Token-Familie.
UPDATE "sessions" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "sessions" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- Rollback-Hinweis: Klartext-Tokens lassen sich absichtlich nicht rekonstruieren.
-- Vor einem Rollback der Anwendung daher alle Web-Sitzungen löschen, die beiden
-- Indizes entfernen, die drei neuen Spalten entfernen und token_hash wieder in
-- token umbenennen. Dadurch werden Benutzer sicher zur Neuanmeldung gezwungen.
