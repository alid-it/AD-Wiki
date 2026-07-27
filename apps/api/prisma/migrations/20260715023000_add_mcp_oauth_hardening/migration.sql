-- Phase 9f: OAuth 2.1 authorization-code flow with PKCE for MCP clients.
ALTER TABLE "mcp_access_tokens"
    ADD COLUMN "oauth_client_id" TEXT,
    ADD COLUMN "resource" TEXT,
    ADD COLUMN "requested_scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "mcp_oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "redirect_uris" TEXT[] NOT NULL,
    "grant_types" TEXT[] NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token']::TEXT[],
    "response_types" TEXT[] NOT NULL DEFAULT ARRAY['code']::TEXT[],
    "token_endpoint_auth_method" TEXT NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorization_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "state" TEXT,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_authorization_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorization_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_key" ON "mcp_oauth_clients"("client_id");
CREATE INDEX "mcp_oauth_clients_last_used_at_idx" ON "mcp_oauth_clients"("last_used_at");
CREATE INDEX "mcp_oauth_authorization_requests_expires_at_idx" ON "mcp_oauth_authorization_requests"("expires_at");
CREATE UNIQUE INDEX "mcp_oauth_authorization_codes_code_hash_key" ON "mcp_oauth_authorization_codes"("code_hash");
CREATE INDEX "mcp_oauth_authorization_codes_expires_at_idx" ON "mcp_oauth_authorization_codes"("expires_at");
CREATE UNIQUE INDEX "mcp_oauth_refresh_tokens_token_hash_key" ON "mcp_oauth_refresh_tokens"("token_hash");
CREATE INDEX "mcp_oauth_refresh_tokens_user_id_created_at_idx" ON "mcp_oauth_refresh_tokens"("user_id", "created_at");
CREATE INDEX "mcp_oauth_refresh_tokens_expires_at_idx" ON "mcp_oauth_refresh_tokens"("expires_at");
CREATE INDEX "mcp_access_tokens_oauth_client_id_created_at_idx" ON "mcp_access_tokens"("oauth_client_id", "created_at");

ALTER TABLE "mcp_access_tokens" ADD CONSTRAINT "mcp_access_tokens_oauth_client_id_fkey" FOREIGN KEY ("oauth_client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_requests" ADD CONSTRAINT "mcp_oauth_authorization_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_authorization_codes" ADD CONSTRAINT "mcp_oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "mcp_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_tokens" ADD CONSTRAINT "mcp_oauth_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
