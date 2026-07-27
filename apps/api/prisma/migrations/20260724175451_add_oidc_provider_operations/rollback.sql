ALTER TABLE "identity_providers"
  DROP COLUMN IF EXISTS "entra_graph_cache_ttl_minutes",
  DROP COLUMN IF EXISTS "entra_graph_fallback_enabled",
  DROP COLUMN IF EXISTS "entra_graph_membership_mode";

DROP TYPE IF EXISTS "EntraGraphMembershipMode";
