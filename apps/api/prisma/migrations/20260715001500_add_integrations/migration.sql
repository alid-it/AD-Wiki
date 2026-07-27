-- Phase 9e: generische Integrationsverbindungen, kurzlebiger OAuth-Zustand,
-- externe Zuordnungen und nachvollziehbare Synchronisationslaeufe.
CREATE TYPE "IntegrationProvider" AS ENUM ('MICROSOFT_TODO');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'ERROR', 'DISCONNECTED');
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "encrypted_token_cache" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "external_account_id" TEXT,
    "external_account_name" TEXT,
    "selected_list_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_oauth_states" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "state_hash" TEXT NOT NULL,
    "encrypted_code_verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_item_mappings" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_list_id" TEXT,
    "local_resource_type" TEXT NOT NULL,
    "local_resource_id" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "external_item_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_sync_runs" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "status" "IntegrationSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_user_id_provider_key" ON "integration_connections"("user_id", "provider");
CREATE INDEX "integration_connections_provider_status_idx" ON "integration_connections"("provider", "status");
CREATE UNIQUE INDEX "integration_oauth_states_state_hash_key" ON "integration_oauth_states"("state_hash");
CREATE INDEX "integration_oauth_states_expires_at_idx" ON "integration_oauth_states"("expires_at");
CREATE UNIQUE INDEX "external_item_mappings_connection_id_external_id_key" ON "external_item_mappings"("connection_id", "external_id");
CREATE INDEX "external_item_mappings_local_resource_type_local_resource_id_idx" ON "external_item_mappings"("local_resource_type", "local_resource_id");
CREATE INDEX "integration_sync_runs_connection_id_started_at_idx" ON "integration_sync_runs"("connection_id", "started_at");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_item_mappings" ADD CONSTRAINT "external_item_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
