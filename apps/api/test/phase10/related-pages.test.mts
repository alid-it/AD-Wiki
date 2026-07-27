import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { RelatedPagesQuerySchema } from "@ad-wiki/shared-types";
import { PagesService } from "../../dist/modules/pages/pages.service.js";

type PagesPrisma = ConstructorParameters<typeof PagesService>[0];

test("Limit für verwandte Seiten wird validiert und auf fünf voreingestellt", () => {
  assert.deepEqual(RelatedPagesQuerySchema.parse({}), { limit: 5 });
  assert.deepEqual(RelatedPagesQuerySchema.parse({ limit: "8" }), { limit: 8 });
  assert.equal(RelatedPagesQuerySchema.safeParse({ limit: 21 }).success, false);
});

test("verwandte Seiten priorisieren gemeinsame Tags vor der Kategorie", async () => {
  const sourceId = "10000000-0000-4000-8000-000000000001";
  const relatedId = "20000000-0000-4000-8000-000000000002";
  let sql = "";
  let values: unknown[] = [];
  const prisma = {
    page: { findFirst: async () => ({ id: sourceId }) },
    $queryRaw: async (query: { text?: string; sql?: string; values?: unknown[] }) => {
      sql = query.text ?? query.sql ?? "";
      values = query.values ?? [];
      return [{
        id: relatedId,
        title: "DNS Troubleshooting",
        slug: "dns-troubleshooting",
        excerpt: "Fehler systematisch eingrenzen",
        shared_tags: ["dns", "network"],
        category_id: "30000000-0000-4000-8000-000000000003",
        category_name: "Netzwerk",
        category_slug: "netzwerk",
      }];
    },
  } as unknown as PagesPrisma;
  const service = new PagesService(prisma);

  const result = await service.findRelated(sourceId, 5);

  assert.match(sql, /COUNT\(DISTINCT shared\.tag_id\) DESC/);
  assert.match(sql, /p\.category_id = s\.category_id/);
  assert.match(sql, /p\.id <>/);
  assert.match(sql, /p\.type::text = 'PAGE'/);
  assert.match(sql, /p\.deleted_at IS NULL/);
  assert.equal(values.includes(5), true);
  assert.deepEqual(result, [{
    id: relatedId,
    title: "DNS Troubleshooting",
    slug: "dns-troubleshooting",
    excerpt: "Fehler systematisch eingrenzen",
    sharedTags: ["dns", "network"],
    category: {
      id: "30000000-0000-4000-8000-000000000003",
      name: "Netzwerk",
      slug: "netzwerk",
    },
  }]);
});

test("gelöschte Seiten und Ordner können nicht als Ausgangsseite verwendet werden", async () => {
  let queryExecuted = false;
  const prisma = {
    page: { findFirst: async () => null },
    $queryRaw: async () => { queryExecuted = true; return []; },
  } as unknown as PagesPrisma;
  const service = new PagesService(prisma);

  await assert.rejects(
    service.findRelated("10000000-0000-4000-8000-000000000001", 5),
    NotFoundException,
  );
  assert.equal(queryExecuted, false);
});
