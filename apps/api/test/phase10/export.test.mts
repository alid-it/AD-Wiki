import assert from "node:assert/strict";
import test from "node:test";
import { PageType } from "@prisma/client";
import { BulkExportQuerySchema } from "@ad-wiki/shared-types";
import { ExportController } from "../../dist/modules/export/export.controller.js";
import { ExportService } from "../../dist/modules/export/export.service.js";

const page = {
  id: "10000000-0000-4000-8000-000000000001",
  title: "DNS Grundlagen",
  slug: "dns-grundlagen",
  type: PageType.PAGE,
  content: "# Auflösung\n\n- [x] Resolver prüfen\n- Cache leeren",
  excerpt: "DNS kompakt",
  status: "PUBLISHED",
  version: 3,
  createdAt: new Date("2026-07-11T08:00:00.000Z"),
  updatedAt: new Date("2026-07-12T09:30:00.000Z"),
  categoryId: "20000000-0000-4000-8000-000000000002",
  parentId: null,
  author: { id: "30000000-0000-4000-8000-000000000003", displayName: "Ada Admin" },
  category: { id: "20000000-0000-4000-8000-000000000002", name: "Netzwerk", slug: "netzwerk" },
  tags: [{ tag: { name: "DNS" } }, { tag: { name: "Grundlagen" } }],
};

type ExportPrisma = ConstructorParameters<typeof ExportService>[0];

function serviceWith(overrides: Record<string, unknown> = {}) {
  const prisma = {
    page: {
      findFirst: async () => page,
      findMany: async () => [page],
    },
    category: {
      findFirst: async () => ({ id: page.category.id, name: page.category.name, slug: page.category.slug, description: "Basiswissen" }),
    },
    note: { findMany: async () => [] },
    standard: { findMany: async () => [] },
    media: { findMany: async () => [] },
    ...overrides,
  } as unknown as ExportPrisma;
  return new ExportService(prisma);
}

test("Bulk-Export-Format wird validiert und auf Markdown voreingestellt", () => {
  assert.deepEqual(BulkExportQuerySchema.parse({}), { format: "markdown" });
  assert.deepEqual(BulkExportQuerySchema.parse({ format: "pdf" }), { format: "pdf" });
  assert.equal(BulkExportQuerySchema.safeParse({ format: "docx" }).success, false);
});

test("Seiten-Markdown enthält vollständiges YAML-Frontmatter und Rohinhalt", async () => {
  const artifact = await serviceWith().exportPageMarkdown(page.id);
  const markdown = artifact.buffer.toString("utf8");

  assert.equal(artifact.filename, "dns-grundlagen.md");
  assert.match(markdown, /^---\ntitle: "DNS Grundlagen"/);
  assert.match(markdown, /author: "Ada Admin"/);
  assert.match(markdown, /created: 2026-07-11/);
  assert.match(markdown, /version: 3/);
  assert.match(markdown, /category: "Netzwerk"/);
  assert.match(markdown, /tags: \["DNS", "Grundlagen"\]/);
  assert.match(markdown, /status: published/);
  assert.match(markdown, /# Auflösung\n\n- \[x\] Resolver prüfen/);
});

test("Seiten-PDF wird als gültiges PDF-Dokument erzeugt", async () => {
  const artifact = await serviceWith().exportPagePdf(page.id);

  assert.equal(artifact.filename, "dns-grundlagen.pdf");
  assert.equal(artifact.mimeType, "application/pdf");
  assert.equal(artifact.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(artifact.buffer.length > 1_000);
  assert.equal((artifact.buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test("Kategorie-Markdown-ZIP bewahrt Ordnerpfade", async () => {
  const folder = { ...page, id: "40000000-0000-4000-8000-000000000004", title: "Basis", slug: "basis", type: PageType.FOLDER, content: "", parentId: null };
  const child = { ...page, parentId: folder.id };
  const prisma = {
    page: { findMany: async () => [folder, child] },
    category: { findFirst: async () => ({ id: page.category.id, name: page.category.name, slug: page.category.slug, description: null }) },
  } as unknown as ExportPrisma;
  const artifact = await new ExportService(prisma).exportCategoryMarkdown(page.category.id);
  const archiveText = artifact.buffer.toString("latin1");

  assert.equal(artifact.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.match(archiveText, /basis\/dns-grundlagen\.md/);
});

test("Bulk-Export liefert ZIP mit Metadaten und wird nachvollziehbar auditiert", async () => {
  const artifact = await serviceWith().exportWiki("html");
  assert.equal(artifact.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.match(artifact.buffer.toString("latin1"), /metadata\.json/);
  assert.equal(artifact.itemCount, 2);

  const calls: unknown[][] = [];
  const controller = new ExportController(
    { exportWiki: async () => artifact } as never,
    { log: async (...args: unknown[]) => { calls.push(args); } } as never,
  );
  const headers = new Map<string, string>();
  const response = { setHeader: (name: string, value: string) => headers.set(name, value) } as never;
  await controller.wiki({ id: "admin-user" } as never, "127.0.0.1", { format: "html" }, response);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 4), ["admin-user", "export.wiki", "export", null]);
  assert.match(headers.get("Content-Disposition") ?? "", /ad-wiki-html-/);
  assert.equal(headers.get("X-Export-Items"), "2");
});
