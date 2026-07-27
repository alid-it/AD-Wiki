-- CreateEnum
CREATE TYPE "IdentityProviderClientAuthMethod" AS ENUM ('NONE', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_BASIC');

-- AlterTable
ALTER TABLE "identity_providers" ADD COLUMN     "client_auth_method" "IdentityProviderClientAuthMethod" NOT NULL DEFAULT 'CLIENT_SECRET_POST';

-- CreateTable
CREATE TABLE "oidc_authorization_requests" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "browser_binding_hash" TEXT NOT NULL,
    "encrypted_code_verifier" TEXT NOT NULL,
    "encrypted_nonce" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_id" TEXT NOT NULL,

    CONSTRAINT "oidc_authorization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_login_codes" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,

    CONSTRAINT "oidc_login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oidc_authorization_requests_state_hash_key" ON "oidc_authorization_requests"("state_hash");

-- CreateIndex
CREATE INDEX "oidc_authorization_requests_expires_at_idx" ON "oidc_authorization_requests"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_login_codes_token_hash_key" ON "oidc_login_codes"("token_hash");

-- CreateIndex
CREATE INDEX "oidc_login_codes_expires_at_used_at_idx" ON "oidc_login_codes"("expires_at", "used_at");

-- AddForeignKey
ALTER TABLE "oidc_authorization_requests" ADD CONSTRAINT "oidc_authorization_requests_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oidc_login_codes" ADD CONSTRAINT "oidc_login_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oidc_login_codes" ADD CONSTRAINT "oidc_login_codes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
