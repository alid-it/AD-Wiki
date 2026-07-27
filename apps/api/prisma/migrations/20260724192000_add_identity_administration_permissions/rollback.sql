DELETE FROM "acls"
WHERE "resource" IN (
  'identity_providers',
  'identity_mappings',
  'identity_sync'
);
