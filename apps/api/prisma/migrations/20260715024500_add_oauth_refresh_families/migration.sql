-- Refresh-token family tracking enables replay detection and family revocation.
ALTER TABLE "mcp_oauth_refresh_tokens" ADD COLUMN "family_id" TEXT;
UPDATE "mcp_oauth_refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "mcp_oauth_refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "mcp_oauth_refresh_tokens_family_id_idx" ON "mcp_oauth_refresh_tokens"("family_id");
