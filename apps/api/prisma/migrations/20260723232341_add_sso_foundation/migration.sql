-- CreateEnum
CREATE TYPE "IdentityProviderType" AS ENUM ('GENERIC_OIDC', 'MICROSOFT_ENTRA', 'KEYCLOAK');

-- CreateEnum
CREATE TYPE "IdentityProviderSyncMode" AS ENUM ('ADD_ONLY', 'MANAGED');

-- CreateEnum
CREATE TYPE "IdentityProviderRoleMappingSource" AS ENUM ('GROUP', 'ROLE');

-- AlterTable
ALTER TABLE "group_memberships" ADD COLUMN     "has_local_grant" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "IdentityProviderType" NOT NULL DEFAULT 'GENERIC_OIDC',
    "issuer" TEXT NOT NULL,
    "discovery_url" TEXT,
    "client_id" TEXT NOT NULL,
    "encrypted_client_secret" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
    "claim_mapping" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "allow_jit_provisioning" BOOLEAN NOT NULL DEFAULT false,
    "group_sync_mode" "IdentityProviderSyncMode" NOT NULL DEFAULT 'ADD_ONLY',
    "group_claim" TEXT,
    "role_claim" TEXT,
    "allow_admin_role_mapping" BOOLEAN NOT NULL DEFAULT false,
    "max_session_age_minutes" INTEGER NOT NULL DEFAULT 480,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "default_role_id" TEXT,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "display_name" TEXT,
    "last_login_at" TIMESTAMP(3),
    "last_group_sync_at" TIMESTAMP(3),
    "last_sync_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_provider_group_mappings" (
    "id" TEXT NOT NULL,
    "external_group_id" TEXT NOT NULL,
    "external_group_path" TEXT,
    "external_group_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "provider_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,

    CONSTRAINT "identity_provider_group_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_provider_role_mappings" (
    "id" TEXT NOT NULL,
    "source" "IdentityProviderRoleMappingSource" NOT NULL,
    "external_value" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "provider_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "identity_provider_role_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_group_membership_grants" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "membership_id" TEXT NOT NULL,
    "external_identity_id" TEXT NOT NULL,
    "group_mapping_id" TEXT NOT NULL,

    CONSTRAINT "external_group_membership_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_name_key" ON "identity_providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_slug_key" ON "identity_providers"("slug");

-- CreateIndex
CREATE INDEX "identity_providers_is_active_display_order_idx" ON "identity_providers"("is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_issuer_client_id_key" ON "identity_providers"("issuer", "client_id");

-- CreateIndex
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_provider_id_issuer_subject_key" ON "external_identities"("provider_id", "issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_provider_id_user_id_key" ON "external_identities"("provider_id", "user_id");

-- CreateIndex
CREATE INDEX "identity_provider_group_mappings_group_id_idx" ON "identity_provider_group_mappings"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_provider_group_mappings_provider_id_external_group_key" ON "identity_provider_group_mappings"("provider_id", "external_group_id");

-- CreateIndex
CREATE INDEX "identity_provider_role_mappings_role_id_idx" ON "identity_provider_role_mappings"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_provider_role_mappings_provider_id_source_external_key" ON "identity_provider_role_mappings"("provider_id", "source", "external_value");

-- CreateIndex
CREATE UNIQUE INDEX "identity_provider_role_mappings_provider_id_priority_key" ON "identity_provider_role_mappings"("provider_id", "priority");

-- CreateIndex
CREATE INDEX "external_group_membership_grants_membership_id_idx" ON "external_group_membership_grants"("membership_id");

-- CreateIndex
CREATE INDEX "external_group_membership_grants_group_mapping_id_idx" ON "external_group_membership_grants"("group_mapping_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_group_membership_grants_external_identity_id_group_key" ON "external_group_membership_grants"("external_identity_id", "group_mapping_id");

-- AddForeignKey
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_default_role_id_fkey" FOREIGN KEY ("default_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_group_mappings" ADD CONSTRAINT "identity_provider_group_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_group_mappings" ADD CONSTRAINT "identity_provider_group_mappings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_role_mappings" ADD CONSTRAINT "identity_provider_role_mappings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_provider_role_mappings" ADD CONSTRAINT "identity_provider_role_mappings_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_group_membership_grants" ADD CONSTRAINT "external_group_membership_grants_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "group_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_group_membership_grants" ADD CONSTRAINT "external_group_membership_grants_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_group_membership_grants" ADD CONSTRAINT "external_group_membership_grants_group_mapping_id_fkey" FOREIGN KEY ("group_mapping_id") REFERENCES "identity_provider_group_mappings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
