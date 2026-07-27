-- Phase 15F: bestehende Administratorrollen erhalten die neuen, getrennten
-- Berechtigungen für Provider, Mappings und Synchronisationsdiagnose.
INSERT INTO "acls" ("id", "role_id", "resource", "action", "allowed", "created_at")
SELECT
  gen_random_uuid(),
  role."id",
  permission."resource",
  permission."action",
  true,
  NOW()
FROM "roles" AS role
CROSS JOIN (
  VALUES
    ('identity_providers', 'read'),
    ('identity_providers', 'update'),
    ('identity_mappings', 'read'),
    ('identity_mappings', 'update'),
    ('identity_sync', 'read'),
    ('identity_sync', 'update')
) AS permission("resource", "action")
WHERE role."name" = 'admin'
ON CONFLICT ("role_id", "resource", "action") DO NOTHING;
