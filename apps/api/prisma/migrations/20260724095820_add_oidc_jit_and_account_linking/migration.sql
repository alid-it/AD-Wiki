/*
  Warnings:

  - Added the required column `external_identity_id` to the `oidc_login_codes` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OidcAuthorizationIntent" AS ENUM ('LOGIN', 'LINK', 'UNLINK');

-- AlterTable
ALTER TABLE "oidc_authorization_requests" ADD COLUMN     "intent" "OidcAuthorizationIntent" NOT NULL DEFAULT 'LOGIN',
ADD COLUMN     "unlink_target_id" TEXT,
ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "oidc_login_codes" ADD COLUMN     "external_identity_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "external_identity_id" TEXT,
ADD COLUMN     "provider_recheck_after" TIMESTAMP(3),
ADD COLUMN     "provider_verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "has_local_password" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "oidc_authorization_requests" ADD CONSTRAINT "oidc_authorization_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oidc_authorization_requests" ADD CONSTRAINT "oidc_authorization_requests_unlink_target_id_fkey" FOREIGN KEY ("unlink_target_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oidc_login_codes" ADD CONSTRAINT "oidc_login_codes_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_external_identity_id_fkey" FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
