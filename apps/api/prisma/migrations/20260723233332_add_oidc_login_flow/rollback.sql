DROP TABLE IF EXISTS "oidc_login_codes";
DROP TABLE IF EXISTS "oidc_authorization_requests";

ALTER TABLE "identity_providers"
  DROP COLUMN IF EXISTS "client_auth_method";

DROP TYPE IF EXISTS "IdentityProviderClientAuthMethod";
