import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ServiceUnavailableException } from "@nestjs/common";
import { PERMISSION_CATALOG } from "@ad-wiki/shared-types";
import { assertSafeOidcUrl } from "../../dist/modules/auth/oidc/oidc-url-security.js";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const API_DIRECTORY = resolve(TEST_DIRECTORY, "../..");

test("Phase 15F trennt Provider-, Mapping- und Synchronisationsrechte", () => {
  assert.deepEqual(PERMISSION_CATALOG.identity_providers, ["read", "update"]);
  assert.deepEqual(PERMISSION_CATALOG.identity_mappings, ["read", "update"]);
  assert.deepEqual(PERMISSION_CATALOG.identity_sync, ["read", "update"]);
});

test("OIDC-SSRF-Schutz sperrt Loopback und private Adressen standardmäßig", async () => {
  await assert.rejects(
    assertSafeOidcUrl("https://127.0.0.1/realms/wiki", "Test-Issuer"),
    ServiceUnavailableException,
  );
  await assert.rejects(
    assertSafeOidcUrl("https://192.168.10.4/realms/wiki", "Test-Issuer"),
    ServiceUnavailableException,
  );
  await assert.rejects(
    assertSafeOidcUrl("https://localhost/realms/wiki", "Test-Issuer"),
    ServiceUnavailableException,
  );
});

test("Explizit freigegebene interne DNS-Namen unterstützen kontrolliertes Keycloak", async () => {
  const original = process.env.OIDC_ALLOWED_PRIVATE_HOSTS;
  process.env.OIDC_ALLOWED_PRIVATE_HOSTS = "keycloak.internal";
  try {
    const url = await assertSafeOidcUrl(
      "https://keycloak.internal/realms/wiki",
      "Keycloak",
    );
    assert.equal(url.hostname, "keycloak.internal");
  } finally {
    if (original === undefined) {
      delete process.env.OIDC_ALLOWED_PRIVATE_HOSTS;
    } else {
      process.env.OIDC_ALLOWED_PRIVATE_HOSTS = original;
    }
  }
});

test("Verwaltungsoberfläche, sichere API und reversible Rechte-Migration sind vorhanden", async () => {
  const migrationDirectory = resolve(
    API_DIRECTORY,
    "prisma/migrations/20260724192000_add_identity_administration_permissions",
  );
  const [page, client, service, migration, rollback, operations] =
    await Promise.all([
      readFile(
        resolve(
          API_DIRECTORY,
          "../web/src/app/settings/identity-providers/page.tsx",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          API_DIRECTORY,
          "../../packages/api-client/src/resources/identity-providers.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(
          API_DIRECTORY,
          "src/modules/auth/oidc/identity-provider-admin.service.ts",
        ),
        "utf8",
      ),
      readFile(resolve(migrationDirectory, "migration.sql"), "utf8"),
      readFile(resolve(migrationDirectory, "rollback.sql"), "utf8"),
      readFile(resolve(API_DIRECTORY, "../../docs/sso-betrieb.md"), "utf8"),
    ]);

  assert.match(page, /testOidcProviderConnection/);
  assert.match(page, /previewOidcSynchronization/);
  assert.match(page, /clientSecretConfigured/);
  assert.match(client, /IdentityProviderDetailsSchema/);
  assert.doesNotMatch(
    service,
    /encryptedClientSecret:\s*row\.encryptedClientSecret/,
  );
  assert.match(migration, /identity_mappings/);
  assert.match(rollback, /DELETE FROM "acls"/);
  assert.match(operations, /Notfallzugang/);
  assert.match(operations, /Key-Rotation/);
});
