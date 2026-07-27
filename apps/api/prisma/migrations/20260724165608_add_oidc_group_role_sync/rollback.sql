-- Entfernt zuerst die abhängigen Rollen-Grants und danach die Claim-Snapshots.
DROP TABLE IF EXISTS "external_role_grants";

ALTER TABLE "external_identities"
  DROP COLUMN IF EXISTS "last_group_claims",
  DROP COLUMN IF EXISTS "last_role_claims";
