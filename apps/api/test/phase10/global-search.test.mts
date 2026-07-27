import assert from "node:assert/strict";
import test from "node:test";
import { GlobalSearchQuerySchema } from "@ad-wiki/shared-types";
import { SearchService } from "../../dist/modules/search/search.service.js";

type SearchPrisma = ConstructorParameters<typeof SearchService>[0];
type SearchAccess = NonNullable<ConstructorParameters<typeof SearchService>[1]>;

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "reader@example.test",
  username: "reader",
  displayName: "Reader",
  roleId: "10000000-0000-4000-8000-000000000002",
  role: "viewer" as const,
  isActive: true,
};

test("globale Suchtypen werden aus dem komma-getrennten Query-Parameter validiert", () => {
  const parsed = GlobalSearchQuerySchema.parse({ q: "  DNS  ", types: "pages, notes", page: "2" });
  assert.deepEqual(parsed, { q: "DNS", types: ["pages", "notes"], page: 2, limit: 20 });
  assert.equal(GlobalSearchQuerySchema.safeParse({ q: "DNS", types: "pages,secrets" }).success, false);
});

test("ohne Leserechte werden keine SQL-Treffer und keine Metadaten offengelegt", async () => {
  let queryExecuted = false;
  const prisma = {
    userPermission: { findUnique: async () => null },
    acl: { findUnique: async () => ({ allowed: false }) },
    $queryRaw: async () => { queryExecuted = true; return []; },
  } as unknown as SearchPrisma;
  const service = new SearchService(prisma);

  const result = await service.globalSearch({ q: "DNS", types: ["notes"], page: 1, limit: 20 }, user);

  assert.deepEqual(result.data, []);
  assert.equal(result.meta.total, 0);
  assert.equal(queryExecuted, false);
});

test("Notizsuche erzwingt Eigentum oder Freigabe und liefert das gemeinsame Format", async () => {
  let sql = "";
  let values: unknown[] = [];
  const now = new Date("2026-07-15T10:00:00.000Z");
  const noteId = "20000000-0000-4000-8000-000000000002";
  const prisma = {
    userPermission: { findUnique: async () => ({ allowed: true }) },
    acl: { findUnique: async () => null },
    $queryRaw: async (query: { text?: string; sql?: string; values?: unknown[] }) => {
      sql = query.text ?? query.sql ?? "";
      values = query.values ?? [];
      return [{
        type: "note",
        id: noteId,
        title: "DNS prüfen",
        excerpt: "Resolver dokumentieren",
        match_field: "title",
        updated_at: now,
        slug: null,
        rank: 1.25,
        total: 1,
      }];
    },
  } as unknown as SearchPrisma;
  const service = new SearchService(prisma);

  const result = await service.globalSearch({ q: "DNS", types: ["notes"], page: 1, limit: 10 }, user);

  assert.match(sql, /n\.deleted_at IS NULL/);
  assert.match(sql, /n\.owner_id/);
  assert.match(sql, /note_shares/);
  assert.equal(values.filter((value) => value === user.id).length >= 2, true);
  assert.deepEqual(result.data[0], {
    type: "note",
    id: noteId,
    title: "DNS prüfen",
    excerpt: "Resolver dokumentieren",
    matchField: "title",
    updatedAt: now.toISOString(),
    url: `/notes?note=${noteId}`,
  });
  assert.equal(result.meta.total, 1);
});

test("Wiki-Suche beschränkt Treffer auf veröffentlichte, aktive Seiten", async () => {
  let sql = "";
  const prisma = {
    userPermission: { findUnique: async () => ({ allowed: true }) },
    acl: { findUnique: async () => null },
    $queryRaw: async (query: { text?: string; sql?: string }) => {
      sql = query.text ?? query.sql ?? "";
      return [];
    },
  } as unknown as SearchPrisma;
  const service = new SearchService(prisma);

  await service.globalSearch({ q: "PKI", types: ["pages"], page: 1, limit: 10 }, user);

  assert.match(sql, /p\.status::text = 'PUBLISHED'/);
  assert.match(sql, /p\.type::text = 'PAGE'/);
  assert.match(sql, /p\.deleted_at IS NULL/);
});

test("anonyme Suche liefert ausschließlich explizit öffentliche Inhaltsseiten", async () => {
  const statements: string[] = [];
  const readSql = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.map(readSql).join(" ");
    }
    if (!value || typeof value !== "object") {
      return "";
    }

    const fragment = value as {
      text?: string;
      sql?: string | readonly string[];
      strings?: readonly string[];
      values?: readonly unknown[];
    };
    const ownSql = Array.isArray(fragment.sql)
      ? fragment.sql.join("?")
      : fragment.sql ?? fragment.text ?? fragment.strings?.join("?") ?? "";

    return `${ownSql} ${readSql(fragment.values)}`.trim();
  };
  const prisma = {
    $queryRaw: async (
      query: { text?: string; sql?: string } | readonly string[],
      ...values: unknown[]
    ) => {
      const outer =
        "join" in query
          ? query.join("?")
          : query.text ?? query.sql ?? "";
      statements.push(`${outer}\n${readSql(query)}\n${readSql(values)}`);
      return statements.length === 1 ? [] : [{ count: 0 }];
    },
    $transaction: async (queries: unknown[]) => Promise.all(queries),
  } as unknown as SearchPrisma;
  const service = new SearchService(prisma);

  await service.search({ q: "PKI", page: 1, limit: 10 });

  assert.equal(statements.length, 2);
  for (const sql of statements) {
    assert.match(sql, /status::text = 'PUBLISHED'/);
    assert.match(sql, /type::text = 'PAGE'/);
    assert.match(sql, /is_public = true/);
    assert.match(sql, /deleted_at IS NULL/);
  }
});

test("Ressourcenfilter verarbeitet leere erlaubte ID-Mengen ohne SQL-Fehler", async () => {
  const pageId = "20000000-0000-4000-8000-000000000003";
  const prisma = {
    userPermission: { findUnique: async () => ({ allowed: true }) },
    acl: { findUnique: async () => null },
    page: { findMany: async () => [{ id: pageId }] },
    note: { findMany: async () => [] },
    standard: { findMany: async () => [] },
    $queryRaw: async () => [],
  } as unknown as SearchPrisma;
  const access = {
    allowedTargetIds: async (
      _actor: unknown,
      input: { targetIds: string[] },
    ) => input.targetIds,
  } as unknown as SearchAccess;
  const service = new SearchService(prisma, access);

  const result = await service.globalSearch(
    { q: "PKI", page: 1, limit: 10 },
    user,
  );

  assert.deepEqual(result.data, []);
  assert.equal(result.meta.total, 0);
});
