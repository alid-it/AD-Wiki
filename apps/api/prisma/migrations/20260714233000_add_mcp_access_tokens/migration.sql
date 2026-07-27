-- Phase 9a: Benutzergebundene, widerrufbare MCP-Zugriffstokens.
-- Es wird ausschliesslich ein SHA-256-Hash gespeichert; der Klartext ist nur
-- unmittelbar nach dem Erstellen sichtbar.
-- Das DROP macht einen zuvor am Foreign-Key fehlgeschlagenen lokalen Lauf
-- wiederholbar. Vor erfolgreichem Abschluss wird diese neue Tabelle nicht genutzt.
DROP TABLE IF EXISTS "mcp_access_tokens" CASCADE;

CREATE TABLE "mcp_access_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_access_tokens_token_hash_key"
    ON "mcp_access_tokens"("token_hash");

CREATE INDEX "mcp_access_tokens_user_id_created_at_idx"
    ON "mcp_access_tokens"("user_id", "created_at");

ALTER TABLE "mcp_access_tokens"
    ADD CONSTRAINT "mcp_access_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
