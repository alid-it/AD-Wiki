ALTER TABLE "sessions"
  DROP CONSTRAINT IF EXISTS "sessions_external_identity_id_fkey",
  DROP COLUMN IF EXISTS "provider_recheck_after",
  DROP COLUMN IF EXISTS "provider_verified_at",
  DROP COLUMN IF EXISTS "external_identity_id";

ALTER TABLE "oidc_login_codes"
  DROP CONSTRAINT IF EXISTS "oidc_login_codes_external_identity_id_fkey",
  DROP COLUMN IF EXISTS "external_identity_id";

ALTER TABLE "oidc_authorization_requests"
  DROP CONSTRAINT IF EXISTS "oidc_authorization_requests_unlink_target_id_fkey",
  DROP CONSTRAINT IF EXISTS "oidc_authorization_requests_user_id_fkey",
  DROP COLUMN IF EXISTS "unlink_target_id",
  DROP COLUMN IF EXISTS "user_id",
  DROP COLUMN IF EXISTS "intent";

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "has_local_password";

DROP TYPE IF EXISTS "OidcAuthorizationIntent";
