import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import { PageStatus, PageType, Prisma } from "@prisma/client";
import { PagesService } from "../../dist/modules/pages/pages.service.js";

type PrismaDependency = ConstructorParameters<typeof PagesService>[0];
const PAGE_ID = "30000000-0000-4000-8000-000000000003";
const AUTHOR_ID = "10000000-0000-4000-8000-000000000001";
const EDITOR_ID = "20000000-0000-4000-8000-000000000002";

function page(version = 3) {
  const now = new Date("2026-07-14T20:00:00.000Z");
  return {
    id: PAGE_ID,
    title: "Alt",
    slug: "alt",
    type: PageType.PAGE,
    content: "Inhalt",
    excerpt: null,
    status: PageStatus.DRAFT,
    isPublic: false,
    mcpVisible: false,
    authorId: AUTHOR_ID,
    categoryId: null,
    parentId: null,
    version,
    sortOrder: 0,
    deletedAt: null,
    deletedById: null,
    createdAt: now,
    updatedAt: now,
    tags: [],
  };
}

test("PagesService verknüpft Snapshot mit MCP-Editor und aktualisiert nur erwartete Version", async () => {
  let snapshotInput: Record<string, unknown> | null = null;
  let updateInput: Record<string, unknown> | null = null;
  const current = page();
  const updated = { ...current, title: "Neu", version: 4 };
  const prisma = {
    page: {
      findFirst: async () => current,
      update: async (input: Record<string, unknown>) => { updateInput = input; return updated; },
    },
    pageVersion: {
      create: async (input: Record<string, unknown>) => { snapshotInput = input; return {}; },
    },
    pageLink: { deleteMany: async () => ({ count: 0 }) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaDependency;
  const subject = new PagesService(prisma);

  const result = await subject.update(PAGE_ID, {
    title: "Neu",
    changeMessage: "[MCP] Test",
  }, { expectedVersion: 3, editorId: EDITOR_ID });

  const snapshotData = (snapshotInput as unknown as { data: Record<string, unknown> }).data;
  assert.deepEqual(snapshotData.author, { connect: { id: EDITOR_ID } });
  assert.equal(snapshotData.version, 3);
  assert.equal(snapshotData.changeMessage, "[MCP] Test");
  assert.deepEqual((updateInput as unknown as { where: unknown }).where, {
    id: PAGE_ID, deletedAt: null, version: 3,
  });
  assert.equal(result.version, 4);
});

test("PagesService erkennt bereits vor der Transaktion eine veraltete Version", async () => {
  let transactionCalled = false;
  const prisma = {
    page: { findFirst: async () => page(4) },
    $transaction: async () => { transactionCalled = true; return []; },
  } as unknown as PrismaDependency;
  const subject = new PagesService(prisma);

  await assert.rejects(
    subject.update(PAGE_ID, { title: "Neu" }, { expectedVersion: 3, editorId: EDITOR_ID }),
    ConflictException,
  );
  assert.equal(transactionCalled, false);
});

test("PagesService übersetzt ein konkurrierendes P2025-Update in Versionskonflikt", async () => {
  const current = page();
  const race = new Prisma.PrismaClientKnownRequestError("Record not found", {
    code: "P2025",
    clientVersion: "7.8.0",
  });
  const prisma = {
    page: {
      findFirst: async () => current,
      update: async () => { throw race; },
    },
    pageVersion: { create: async () => ({}) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaDependency;
  const subject = new PagesService(prisma);

  await assert.rejects(
    subject.update(PAGE_ID, { title: "Neu" }, { expectedVersion: 3, editorId: EDITOR_ID }),
    ConflictException,
  );
});

test("Checkbox-Toggles ändern Inhalt ohne PageVersion oder Versionssprung", async () => {
  const current = { ...page(), content: "- [ ] DNS prüfen" };
  let updateInput: Record<string, unknown> | null = null;
  const prisma = {
    page: {
      findFirst: async () => ({ id: current.id, content: current.content }),
      update: async (input: Record<string, unknown>) => {
        updateInput = input;
        const content = (input.data as { content: string }).content;
        return { ...current, content };
      },
    },
  } as unknown as PrismaDependency;
  const subject = new PagesService(prisma);

  const result = await subject.toggleCheckbox(PAGE_ID, { checkboxIndex: 0, checked: true });

  assert.equal(result.content, "- [x] DNS prüfen");
  assert.equal(result.version, current.version);
  assert.deepEqual((updateInput as unknown as { data: unknown }).data, { content: "- [x] DNS prüfen" });
});
