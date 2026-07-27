import assert from "node:assert/strict";
import test from "node:test";
import * as bcrypt from "bcrypt";
import { CreateApiKeySchema } from "@ad-wiki/shared-types";
import { ApiKeysService } from "../../dist/modules/api-keys/api-keys.service.js";

type ApiKeysPrisma = ConstructorParameters<typeof ApiKeysService>[0];

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  username: "ada",
  displayName: "Ada Admin",
  isActive: true,
  role: { name: "admin" },
};

test("API-Key-Vertrag validiert Namen, Ablaufdatum und optionale Rechte", () => {
  assert.equal(CreateApiKeySchema.safeParse({ name: "" }).success, false);
  assert.equal(CreateApiKeySchema.safeParse({ name: "Backup", expiresAt: "ungueltig" }).success, false);
  assert.equal(CreateApiKeySchema.safeParse({
    name: "CI/CD",
    permissions: [{ resource: "pages", action: "read" }],
  }).success, true);
  assert.equal(CreateApiKeySchema.safeParse({
    name: "Unmoeglich",
    permissions: [{ resource: "media", action: "share" }],
  }).success, false);
});

test("Klartext wird einmalig ausgegeben, aber nur SHA-256 und bcrypt persistiert", async () => {
  const writes: Record<string, unknown>[] = [];
  const createdAt = new Date("2026-07-15T12:00:00.000Z");
  const prisma = {
    apiKey: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return {
          id: "20000000-0000-4000-8000-000000000002",
          name: data.name,
          permissions: data.permissions ?? null,
          lastUsedAt: null,
          expiresAt: data.expiresAt ?? null,
          createdAt,
          isActive: true,
        };
      },
    },
  } as unknown as ApiKeysPrisma;

  const result = await new ApiKeysService(prisma).create(user.id, { name: "CI/CD" });
  const stored = writes[0];
  assert.match(result.key, /^ad_wiki_[A-Za-z0-9_-]{48}$/);
  assert.ok(stored);
  assert.notEqual(stored.key, result.key);
  assert.match(String(stored.key), /^[a-f0-9]{64}$/);
  assert.notEqual(stored.keyHash, result.key);
  assert.equal(await bcrypt.compare(result.key, String(stored.keyHash)), true);
  assert.equal(JSON.stringify(stored).includes(result.key), false);
});

test("Guards erhalten nur aktive, nicht abgelaufene Keys und lastUsedAt wird aktualisiert", async () => {
  const rawKey = `ad_wiki_${"a".repeat(48)}`;
  const keyHash = await bcrypt.hash(rawKey, 4);
  let lastUsedWritten = false;
  const prisma = {
    apiKey: {
      findUnique: async () => ({
        id: "20000000-0000-4000-8000-000000000002",
        name: "Automation",
        keyHash,
        permissions: [{ resource: "pages", action: "read" }],
        lastUsedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        isActive: true,
        userId: user.id,
        key: "lookup",
        user,
      }),
      update: async () => {
        lastUsedWritten = true;
        return { id: "20000000-0000-4000-8000-000000000002" };
      },
    },
  } as unknown as ApiKeysPrisma;

  const verified = await new ApiKeysService(prisma).verify(rawKey);
  assert.equal(verified?.user.id, user.id);
  assert.equal(verified?.user.authenticationMethod, "apiKey");
  assert.deepEqual(verified?.permissions, [{ resource: "pages", action: "read" }]);
  assert.equal(lastUsedWritten, true);
});
