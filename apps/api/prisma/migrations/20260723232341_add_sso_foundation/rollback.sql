DROP TABLE IF EXISTS "external_group_membership_grants";
DROP TABLE IF EXISTS "identity_provider_role_mappings";
DROP TABLE IF EXISTS "identity_provider_group_mappings";
DROP TABLE IF EXISTS "external_identities";
DROP TABLE IF EXISTS "identity_providers";

ALTER TABLE "group_memberships"
  DROP COLUMN IF EXISTS "has_local_grant";

DROP TYPE IF EXISTS "IdentityProviderRoleMappingSource";
DROP TYPE IF EXISTS "IdentityProviderSyncMode";
DROP TYPE IF EXISTS "IdentityProviderType";
