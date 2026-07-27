import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { McpTokenService } from "../../dist/modules/mcp/mcp-token.service.js";

type PrismaDependency = ConstructorParameters<typeof McpTokenService>[0];
type AuthDependency = ConstructorParameters<typeof McpTokenService>[1];

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_ID = "20000000-0000-4000-8000-000000000002";

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN_ID,
    userId: USER_ID,
    name: "Codex",
    tokenHash: "hash",
    tokenPrefix: "ad_wiki_mcp_abcdefgh",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    ...overrides,
  };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "admin@ad-wiki.local",
    username: "admin",
    displayName: "Admin",
    isActive: true,
    role: { name: "ADMIN" },
    ...overrides,
  };
}

function authenticatedRow(overrides: Record<string, unknown> = {}) {
  return tokenRow({
    user: userRow(),
    ...overrides,
  });
}

test("create speichert nur den SHA-256-Hash und gibt den Klartext einmalig zurück", async () => {
  const createCalls: Record<string, unknown>[] = [];
  const prisma = {
    mcpAccessToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCalls.push(data);
        return tokenRow({
          tokenHash: data.tokenHash,
          tokenPrefix: data.tokenPrefix,
          expiresAt: data.expiresAt,
        });
      },
    },
  };
  const service = new McpTokenService(
    prisma as unknown as PrismaDependency,
    {} as AuthDependency,
  );

  const result = await service.create(USER_ID, {
    name: "Codex",
    expiresAt: "2026-12-31T23:59:59.000Z",
  });

  assert.match(result.token, /^ad_wiki_mcp_[A-Za-z0-9_-]{43}$/);
  const createData = createCalls[0];
  assert.ok(createData);
  assert.equal(
    createData.tokenHash,
    createHash("sha256").update(result.token, "utf8").digest("hex"),
  );
  assert.equal(createData.tokenPrefix, result.tokenPrefix);
  assert.equal(JSON.stringify(createData).includes(result.token), false);
});

test("create lehnt abgelaufene Token ab", async () => {
  const service = new McpTokenService(
    { mcpAccessToken: {} } as unknown as PrismaDependency,
    {} as AuthDependency,
  );

  await assert.rejects(
    service.create(USER_ID, { name: "Alt", expiresAt: "2020-01-01T00:00:00.000Z" }),
    BadRequestException,
  );
});

test("revoke ist eigentümergebunden und idempotent", async () => {
  let current = tokenRow();
  let updateCount = 0;
  const prisma = {
    mcpAccessToken: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === TOKEN_ID && where.userId === USER_ID ? current : null,
      update: async () => {
        updateCount += 1;
        current = tokenRow({ revokedAt: new Date("2026-07-14T01:00:00.000Z") });
        return current;
      },
    },
  };
  const service = new McpTokenService(
    prisma as unknown as PrismaDependency,
    {} as AuthDependency,
  );

  assert.equal((await service.revoke(USER_ID, TOKEN_ID)).active, false);
  assert.equal((await service.revoke(USER_ID, TOKEN_ID)).active, false);
  assert.equal(updateCount, 1);
  await assert.rejects(
    service.revoke("30000000-0000-4000-8000-000000000003", TOKEN_ID),
    NotFoundException,
  );
});

test("verify lädt aktuelle ACLs und aktualisiert lastUsedAt gedrosselt", async () => {
  const updateCalls: Record<string, unknown>[] = [];
  const prisma = {
    mcpAccessToken: {
      findUnique: async () => authenticatedRow(),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updateCalls.push(data);
        return tokenRow(data);
      },
    },
  };
  const auth = {
    getEffectivePermissions: async () => [
      { resource: "mcp", action: "read", allowed: true },
      { resource: "pages", action: "read", allowed: true },
      { resource: "notes", action: "read", allowed: false },
    ],
  };
  const service = new McpTokenService(
    prisma as unknown as PrismaDependency,
    auth as unknown as AuthDependency,
  );

  const result = await service.verify(`ad_wiki_mcp_${"a".repeat(43)}`);

  assert.equal(result?.tokenId, TOKEN_ID);
  assert.deepEqual(result?.scopes, ["mcp:read", "pages:read"]);
  assert.equal(result?.user.id, USER_ID);
  const updateData = updateCalls[0];
  assert.ok(updateData?.lastUsedAt instanceof Date);
});

test("verify verweigert ungültige, widerrufene und unberechtigte Zugriffe", async (t) => {
  await t.test("falsches Präfix", async () => {
    let queried = false;
    const service = new McpTokenService(
      {
        mcpAccessToken: {
          findUnique: async () => {
            queried = true;
            return null;
          },
        },
      } as unknown as PrismaDependency,
      {} as AuthDependency,
    );
    assert.equal(await service.verify("falsch"), null);
    assert.equal(queried, false);
  });

  for (const [name, row] of [
    ["widerrufen", authenticatedRow({ revokedAt: new Date() })],
    ["abgelaufen", authenticatedRow({ expiresAt: new Date("2020-01-01T00:00:00.000Z") })],
    ["Benutzer inaktiv", authenticatedRow({ user: userRow({ isActive: false }) })],
  ] as const) {
    await t.test(name, async () => {
      const service = new McpTokenService(
        { mcpAccessToken: { findUnique: async () => row } } as unknown as PrismaDependency,
        {} as AuthDependency,
      );
      assert.equal(await service.verify(`ad_wiki_mcp_${"b".repeat(43)}`), null);
    });
  }

  await t.test("mcp:read fehlt", async () => {
    const service = new McpTokenService(
      { mcpAccessToken: { findUnique: async () => authenticatedRow() } } as unknown as PrismaDependency,
      {
        getEffectivePermissions: async () => [
          { resource: "pages", action: "read", allowed: true },
        ],
      } as unknown as AuthDependency,
    );
    assert.equal(await service.verify(`ad_wiki_mcp_${"c".repeat(43)}`), null);
  });
});
