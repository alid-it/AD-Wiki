import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  McpKnowledgeCatalogOutputSchema,
  McpKnowledgeListOutputSchema,
  McpKnowledgeReadOutputSchema,
  McpKnowledgeSearchOutputSchema,
} from "@ad-wiki/shared-types";
import { KnowledgeAccessService } from "../../dist/modules/knowledge/knowledge-access.service.js";

type PrismaDependency = ConstructorParameters<typeof KnowledgeAccessService>[0];

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PAGE_ID = "20000000-0000-4000-8000-000000000002";
const NOTE_ID = "30000000-0000-4000-8000-000000000003";
const STANDARD_ID = "40000000-0000-4000-8000-000000000004";
const CATEGORY_ID = "50000000-0000-4000-8000-000000000005";
const UPDATED_AT = new Date("2026-07-14T10:00:00.000Z");

function context(...scopes: string[]) {
  return { userId: USER_ID, scopes };
}

test("list_knowledge aggregiert nur erlaubte Wissenstypen über die bestehenden Sichtbarkeitsfilter", async () => {
  let noteQueried = false;
  let standardQueried = false;
  const service = new KnowledgeAccessService({
    page: {
      findMany: async () => [{
        id: PAGE_ID,
        title: "DNS-Grundlagen",
        slug: "dns-grundlagen",
        status: "PUBLISHED",
        version: 3,
        updatedAt: UPDATED_AT,
      }],
    },
    note: {
      findMany: async () => {
        noteQueried = true;
        return [];
      },
    },
    standard: {
      findMany: async () => {
        standardQueried = true;
        return [];
      },
    },
  } as unknown as PrismaDependency);

  const output = await service.listKnowledge(
    context("pages:read"),
    { limitPerType: 20, cursors: {} },
  );

  assert.equal(output.results.wiki.length, 1);
  assert.deepEqual(output.results.notes, []);
  assert.deepEqual(output.results.standards, []);
  assert.equal(output.sources[0].uri, "ad-wiki://wiki/dns-grundlagen");
  assert.equal(output.warnings.length, 2);
  assert.equal(noteQueried, false);
  assert.equal(standardQueried, false);
  McpKnowledgeCatalogOutputSchema.parse(output);
});

test("ACL wird vor jedem Datenbankzugriff erzwungen", async () => {
  let queried = false;
  const service = new KnowledgeAccessService({
    page: {
      findMany: async () => {
        queried = true;
        return [];
      },
    },
  } as unknown as PrismaDependency);

  await assert.rejects(
    service.listWiki(context("mcp:read"), { limit: 20 }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("Wiki-Listen filtern Status, Typ, Löschung und MCP-Freigabe", async () => {
  const queries: Record<string, unknown>[] = [];
  const service = new KnowledgeAccessService({
    page: {
      findMany: async (input: Record<string, unknown>) => {
        queries.push(input);
        return [
          {
            id: PAGE_ID,
            title: "DNS-Grundlagen",
            slug: "dns-grundlagen",
            status: "PUBLISHED",
            version: 3,
            updatedAt: UPDATED_AT,
          },
          {
            id: "21000000-0000-4000-8000-000000000002",
            title: "Zweiter Treffer",
            slug: "zweiter-treffer",
            status: "PUBLISHED",
            version: 1,
            updatedAt: new Date("2026-07-13T10:00:00.000Z"),
          },
        ];
      },
    },
  } as unknown as PrismaDependency);

  const output = await service.listWiki(context("pages:read"), { limit: 1 });

  assert.deepEqual((queries[0] as { where: unknown }).where, {
    type: "PAGE",
    status: "PUBLISHED",
    mcpVisible: true,
    deletedAt: null,
  });
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].uri, "ad-wiki://wiki/dns-grundlagen");
  assert.ok(output.nextCursor);
  McpKnowledgeListOutputSchema.parse(output);
});

test("Wiki-Suche nutzt deutsche Volltextsuche und alle Sichtbarkeitsfilter", async () => {
  let sqlText = "";
  const service = new KnowledgeAccessService({
    $queryRaw: async (strings: TemplateStringsArray) => {
      sqlText = strings.join("?");
      return [
        {
          id: PAGE_ID,
          kind: "wiki",
          title: "DNS-Grundlagen",
          status: "PUBLISHED",
          version: 3,
          updatedAt: UPDATED_AT,
          resourceKey: "dns-grundlagen",
          knowledgePriority: 2,
          excerpt: "DNS ordnet Namen den IP-Adressen zu.",
          score: 0.75,
        },
        {
          id: "21000000-0000-4000-8000-000000000002",
          kind: "wiki",
          title: "DNSSEC",
          status: "PUBLISHED",
          version: 2,
          updatedAt: new Date("2026-07-13T10:00:00.000Z"),
          resourceKey: "dnssec",
          knowledgePriority: 2,
          excerpt: null,
          score: 0.5,
        },
      ];
    },
  } as unknown as PrismaDependency);

  const output = await service.searchWiki(
    context("pages:read"),
    { query: "DNS", limit: 1 },
  );

  assert.match(sqlText, /type::text = 'PAGE'/);
  assert.match(sqlText, /status::text = 'PUBLISHED'/);
  assert.match(sqlText, /mcp_visible = TRUE/);
  assert.match(sqlText, /deleted_at IS NULL/);
  assert.match(sqlText, /ORDER BY score DESC, "updatedAt" DESC, kind ASC, id DESC/);
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].sourceId, PAGE_ID);
  assert.equal(output.sources[0].knowledgePriority, 2);
  assert.ok(output.nextCursor);
  McpKnowledgeSearchOutputSchema.parse(output);

  await assert.rejects(
    service.searchWiki(context("pages:read"), {
      query: "anderer Begriff",
      limit: 1,
      cursor: output.nextCursor ?? undefined,
    }),
    BadRequestException,
  );
});

test("Wiki-Suche erzwingt ACL vor der Volltextabfrage", async () => {
  let queried = false;
  const service = new KnowledgeAccessService({
    $queryRaw: async () => {
      queried = true;
      return [];
    },
  } as unknown as PrismaDependency);

  await assert.rejects(
    service.searchWiki(context("mcp:read"), { query: "DNS", limit: 20 }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("search_knowledge überspringt unerlaubte Typen ohne Metadaten preiszugeben", async () => {
  let sqlText = "";
  let sqlValues: unknown[] = [];
  const service = new KnowledgeAccessService({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlText = strings.join("?");
      sqlValues = values;
      return [{
        id: PAGE_ID,
        kind: "wiki",
        title: "DNS-Grundlagen",
        status: "PUBLISHED",
        version: 3,
        updatedAt: UPDATED_AT,
        resourceKey: "dns-grundlagen",
        knowledgePriority: 2,
        excerpt: "DNS-Inhalt",
        score: 0.65,
      }];
    },
  } as unknown as PrismaDependency);

  const output = await service.searchKnowledge(
    context("pages:read"),
    {
      query: "DNS",
      types: ["standard", "wiki", "note"],
      limit: 20,
    },
  );

  assert.deepEqual(
    sqlValues.filter((value): value is boolean => typeof value === "boolean"),
    [true, false, false, false],
  );
  assert.match(sqlText, /n\.owner_id/);
  assert.match(sqlText, /FROM note_shares share/);
  assert.match(sqlText, /s\.valid_from IS NULL/);
  assert.match(sqlText, /s\.valid_until IS NULL/);
  assert.equal(output.sources[0].uri, "ad-wiki://wiki/dns-grundlagen");
  assert.equal(output.warnings.length, 2);
  assert.equal(output.warnings.some((warning) => warning.includes("note")), true);
  assert.equal(output.warnings.some((warning) => warning.includes("standard")), true);
  McpKnowledgeSearchOutputSchema.parse(output);
});

test("search_knowledge verweigert die Abfrage, wenn kein angeforderter Typ erlaubt ist", async () => {
  let queried = false;
  const service = new KnowledgeAccessService({
    $queryRaw: async () => {
      queried = true;
      return [];
    },
  } as unknown as PrismaDependency);

  await assert.rejects(
    service.searchKnowledge(context("mcp:read"), {
      query: "DNS",
      types: ["wiki", "note", "standard"],
      limit: 20,
    }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("Cursor sind opak, stabil und werden streng validiert", async () => {
  const queries: Record<string, unknown>[] = [];
  const service = new KnowledgeAccessService({
    page: {
      findMany: async (input: Record<string, unknown>) => {
        queries.push(input);
        return [{
          id: PAGE_ID,
          title: "DNS",
          slug: "dns",
          status: "PUBLISHED",
          version: 1,
          updatedAt: UPDATED_AT,
        }];
      },
    },
  } as unknown as PrismaDependency);

  const first = await service.listWiki(context("pages:read"), { limit: 1 });
  const forcedCursor = Buffer.from(JSON.stringify({
    id: PAGE_ID,
    updatedAt: UPDATED_AT.toISOString(),
  })).toString("base64url");
  await service.listWiki(context("pages:read"), { limit: 1, cursor: forcedCursor });

  assert.deepEqual((queries[1] as { where: unknown }).where, {
    AND: [
      { type: "PAGE", status: "PUBLISHED", mcpVisible: true, deletedAt: null },
      {
        OR: [
          { updatedAt: { lt: UPDATED_AT } },
          { updatedAt: UPDATED_AT, id: { lt: PAGE_ID } },
        ],
      },
    ],
  });
  assert.equal(first.nextCursor, null);
  await assert.rejects(
    service.listWiki(context("pages:read"), { limit: 1, cursor: "ungültig" }),
    BadRequestException,
  );
});

test("unsichtbare Einzelressourcen liefern immer denselben 404-Fehler", async () => {
  let where: unknown = null;
  const service = new KnowledgeAccessService({
    page: {
      findFirst: async (input: { where: unknown }) => {
        where = input.where;
        return null;
      },
    },
  } as unknown as PrismaDependency);

  await assert.rejects(
    service.readWiki(context("pages:read"), { slug: "geheim" }),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal(error.message, "Wissensinhalt wurde nicht gefunden.");
      return true;
    },
  );
  assert.deepEqual(where, {
    type: "PAGE",
    status: "PUBLISHED",
    mcpVisible: true,
    deletedAt: null,
    slug: "geheim",
  });
});

test("Notizen sind nur sichtbar, wenn Status, Freigabe und Benutzerzugriff passen", async () => {
  let listWhere: unknown = null;
  let readWhere: unknown = null;
  let readSelect: unknown = null;
  const service = new KnowledgeAccessService({
    note: {
      findMany: async (input: { where: unknown }) => {
        listWhere = input.where;
        return [];
      },
      findFirst: async (input: { where: unknown; select: unknown }) => {
        readWhere = input.where;
        readSelect = input.select;
        return {
          id: NOTE_ID,
          title: null,
          content: "Temporärer Arbeitskontext",
          status: "CAPTURED",
          updatedAt: UPDATED_AT,
          ownerId: "60000000-0000-4000-8000-000000000006",
          category: null,
          tags: [{ tag: { name: "DNS" } }],
          shares: [{ permission: "VIEW" }],
        };
      },
    },
  } as unknown as PrismaDependency);

  await service.listNotes(context("notes:read"), { limit: 20 });
  const output = await service.readNote(context("notes:read"), NOTE_ID);

  assert.deepEqual(listWhere, {
    status: { not: "ARCHIVED" },
    mcpVisible: true,
    deletedAt: null,
    OR: [
      { ownerId: USER_ID },
      { shares: { some: { userId: USER_ID } } },
    ],
  });
  assert.deepEqual(readWhere, {
    status: { not: "ARCHIVED" },
    mcpVisible: true,
    deletedAt: null,
    OR: [
      { ownerId: USER_ID },
      { shares: { some: { userId: USER_ID } } },
    ],
    id: NOTE_ID,
  });
  const shareSelect = (readSelect as {
    shares: { where: unknown; select: unknown; take: number };
  }).shares;
  assert.deepEqual(shareSelect, {
    where: { userId: USER_ID },
    select: { permission: true },
    take: 1,
  });
  assert.deepEqual(output.result.metadata, {
    isOwner: false,
    sharePermission: "view",
  });
  assert.equal(JSON.stringify(output).includes("60000000-0000-4000-8000-000000000006"), false);
  McpKnowledgeReadOutputSchema.parse(output);
});

test("Richtlinien müssen aktiv, freigegeben und am Stichtag gültig sein", async () => {
  const now = new Date("2026-07-14T12:00:00.000Z");
  let where: unknown = null;
  const service = new KnowledgeAccessService({
    standard: {
      findMany: async (input: { where: unknown }) => {
        where = input.where;
        return [{
          id: STANDARD_ID,
          title: "VM-Basisstandard",
          slug: "vm-basisstandard",
          status: "ACTIVE",
          version: 4,
          updatedAt: UPDATED_AT,
        }];
      },
    },
  } as unknown as PrismaDependency);

  const output = await service.listStandards(
    context("standards:read"),
    { limit: 20 },
    now,
  );

  assert.deepEqual(where, {
    status: "ACTIVE",
    mcpVisible: true,
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    ],
  });
  assert.equal(output.results[0].knowledgePriority, 1);
  assert.equal(output.results[0].uri, `ad-wiki://standards/${STANDARD_ID}`);
});

test("Richtlinien-Dokumente liefern strukturierte Regeln ohne interne Benutzerfelder", async () => {
  const service = new KnowledgeAccessService({
    standard: {
      findFirst: async () => ({
        id: STANDARD_ID,
        title: "VM-Basisstandard",
        slug: "vm-basisstandard",
        status: "ACTIVE",
        version: 4,
        updatedAt: UPDATED_AT,
        description: "Verbindliche Mindestwerte.",
        justification: "Sicherer Betrieb.",
        priority: "CRITICAL",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: null,
        category: { id: CATEGORY_ID, name: "Virtualisierung", slug: "virtualisierung" },
        rules: [{
          id: "70000000-0000-4000-8000-000000000007",
          title: "Mindestens 8 GB RAM",
          description: null,
          type: "MUST",
          sortOrder: 1,
          minVcpu: null,
          minRamMb: 8192,
          backupRequired: true,
          allowedPorts: [],
          allowedNetworks: [],
          namingConvention: null,
        }],
      }),
    },
  } as unknown as PrismaDependency);

  const output = await service.readStandard(
    context("standards:read"),
    { id: STANDARD_ID },
    new Date("2026-07-14T12:00:00.000Z"),
  );

  assert.match(output.result.content, /Mindestens 8 GB RAM/);
  assert.deepEqual(output.result.metadata.rules, [{
    id: "70000000-0000-4000-8000-000000000007",
    title: "Mindestens 8 GB RAM",
    description: null,
    type: "must",
    sortOrder: 1,
    minVcpu: null,
    minRamMb: 8192,
    backupRequired: true,
    allowedPorts: [],
    allowedNetworks: [],
    namingConvention: null,
  }]);
  McpKnowledgeReadOutputSchema.parse(output);
});
