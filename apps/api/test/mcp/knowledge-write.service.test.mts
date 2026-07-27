import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { PageStatus, PageType } from "@prisma/client";
import { KnowledgeWriteService } from "../../dist/modules/knowledge/knowledge-write.service.js";

type PagesDependency = ConstructorParameters<typeof KnowledgeWriteService>[0];
type NotesDependency = ConstructorParameters<typeof KnowledgeWriteService>[1];
type StandardsDependency = ConstructorParameters<typeof KnowledgeWriteService>[2];
type AuditDependency = ConstructorParameters<typeof KnowledgeWriteService>[3];

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_ID = "20000000-0000-4000-8000-000000000002";
const PAGE_ID = "30000000-0000-4000-8000-000000000003";
const NOTE_ID = "40000000-0000-4000-8000-000000000004";
const STANDARD_ID = "50000000-0000-4000-8000-000000000005";

const context = {
  userId: USER_ID,
  tokenId: TOKEN_ID,
  scopes: ["pages:create", "pages:update", "notes:create", "notes:update", "standards:create"],
};

function service(dependencies: {
  pages?: Partial<PagesDependency>;
  notes?: Partial<NotesDependency>;
  standards?: Partial<StandardsDependency>;
  audit?: Partial<AuditDependency>;
} = {}) {
  return new KnowledgeWriteService(
    dependencies.pages as PagesDependency ?? {} as PagesDependency,
    dependencies.notes as NotesDependency ?? {} as NotesDependency,
    dependencies.standards as StandardsDependency ?? {} as StandardsDependency,
    dependencies.audit as AuditDependency ?? { log: async () => undefined } as unknown as AuditDependency,
  );
}

test("create_page erzwingt Entwurf, Sichtbarkeit und Tokenbenutzer", async () => {
  const calls: unknown[][] = [];
  const auditCalls: unknown[][] = [];
  const subject = service({
    pages: {
      create: async (...args: unknown[]) => {
        calls.push(args);
        return { id: PAGE_ID, title: "MCP-Seite", slug: "mcp-seite", status: "draft", version: 1 } as never;
      },
    },
    audit: { log: async (...args: unknown[]) => { auditCalls.push(args); } },
  });

  const output = await subject.createPage(context, {
    title: "MCP-Seite", content: "Inhalt", tags: [],
  });

  assert.equal(calls[0][1], USER_ID);
  assert.deepEqual(calls[0][0], {
    title: "MCP-Seite", content: "Inhalt", tags: [], type: "page",
    status: "draft", isPublic: false, mcpVisible: false,
  });
  assert.equal(output.result.mcpVisible, false);
  assert.equal(output.result.status, "draft");
  assert.equal((auditCalls[0][4] as Record<string, unknown>).tokenId, TOKEN_ID);
  assert.equal(JSON.stringify(auditCalls).includes("Inhalt"), false);
});

test("update_page reicht expectedVersion atomar und den MCP-Editor weiter", async () => {
  const calls: unknown[][] = [];
  const subject = service({
    pages: {
      findUpdateState: async () => ({ type: PageType.PAGE, status: PageStatus.DRAFT, version: 3 }) as never,
      update: async (...args: unknown[]) => {
        calls.push(args);
        return { id: PAGE_ID, title: "Neu", slug: "seite", status: "draft", version: 4 } as never;
      },
    },
  });

  const output = await subject.updatePage(context, {
    id: PAGE_ID,
    expectedVersion: 3,
    title: "Neu",
    changeMessage: "Titel präzisiert",
  });

  assert.equal(calls[0][0], PAGE_ID);
  assert.deepEqual(calls[0][1], {
    title: "Neu", mcpVisible: false, changeMessage: "[MCP] Titel präzisiert",
  });
  assert.deepEqual(calls[0][2], { expectedVersion: 3, editorId: USER_ID });
  assert.equal(output.result.version, 4);
});

test("update_page blockiert veröffentlichte Seiten vor jeder Änderung", async () => {
  let updated = false;
  const subject = service({ pages: {
    findUpdateState: async () => ({ type: PageType.PAGE, status: PageStatus.PUBLISHED, version: 3 }) as never,
    update: async () => { updated = true; return {} as never; },
  } });

  await assert.rejects(
    subject.updatePage(context, {
      id: PAGE_ID, expectedVersion: 3, title: "Neu", changeMessage: "Test",
    }),
    ConflictException,
  );
  assert.equal(updated, false);
});

test("create_note setzt Besitzer und Sichtbarkeit serverseitig", async () => {
  const calls: unknown[][] = [];
  const subject = service({ notes: {
    create: async (...args: unknown[]) => {
      calls.push(args);
      return { id: NOTE_ID, title: null, content: "Erfasste Notiz", status: "captured", mcpVisible: false } as never;
    },
  } });

  const output = await subject.createNote(context, {
    content: "Erfasste Notiz", tags: [],
  });
  assert.deepEqual(calls[0], [{ content: "Erfasste Notiz", tags: [], mcpVisible: false }, USER_ID]);
  assert.equal(output.result.title, "Erfasste Notiz");
  assert.equal(output.result.status, "captured");
});

test("update_note übergibt nur erlaubte Felder und den Tokenbenutzer", async () => {
  const calls: unknown[][] = [];
  const subject = service({ notes: {
    update: async (...args: unknown[]) => {
      calls.push(args);
      return { id: NOTE_ID, title: "Neu", content: "Inhalt", status: "captured", mcpVisible: true } as never;
    },
  } });
  const output = await subject.updateNote(context, { id: NOTE_ID, title: "Neu" });
  assert.deepEqual(calls[0], [NOTE_ID, { title: "Neu" }, USER_ID]);
  assert.equal(output.result.mcpVisible, true);
});

test("create_standard_draft erzwingt Verantwortlichen und deaktivierte Freigabe", async () => {
  const calls: unknown[][] = [];
  const subject = service({ standards: {
    create: async (...args: unknown[]) => {
      calls.push(args);
      return { id: STANDARD_ID, title: "Basis", status: "draft", version: 1 } as never;
    },
  } });
  const output = await subject.createStandardDraft(context, {
    title: "Basis", description: "Beschreibung", justification: "Begründung",
    priority: "medium", pageIds: [], rules: [],
  });
  assert.equal((calls[0][0] as Record<string, unknown>).responsibleId, USER_ID);
  assert.equal((calls[0][0] as Record<string, unknown>).mcpVisible, false);
  assert.equal(calls[0][1], USER_ID);
  assert.equal(output.result.status, "draft");
});

test("fehlender Schreib-Scope beendet den Aufruf vor dem Fachdienst", async () => {
  let created = false;
  const subject = service({ pages: {
    create: async () => { created = true; return {} as never; },
  } });
  await assert.rejects(
    subject.createPage({ userId: USER_ID, scopes: [] }, { title: "Nein", content: "", tags: [] }),
    ForbiddenException,
  );
  assert.equal(created, false);
});

test("jede erfolgreiche Mutation erzeugt ein fachliches MCP-Audit", async () => {
  const auditCalls: unknown[][] = [];
  const subject = service({
    pages: {
      create: async () => ({ id: PAGE_ID, title: "Seite", slug: "seite", status: "draft", version: 1 }) as never,
      findUpdateState: async () => ({ type: PageType.PAGE, status: PageStatus.DRAFT, version: 1 }) as never,
      update: async () => ({ id: PAGE_ID, title: "Seite 2", slug: "seite", status: "draft", version: 2 }) as never,
    },
    notes: {
      create: async () => ({ id: NOTE_ID, title: "Notiz", content: "Inhalt", status: "captured", mcpVisible: false }) as never,
      update: async () => ({ id: NOTE_ID, title: "Notiz 2", content: "Inhalt", status: "captured", mcpVisible: false }) as never,
    },
    standards: {
      create: async () => ({ id: STANDARD_ID, title: "Standard", status: "draft", version: 1 }) as never,
    },
    audit: { log: async (...args: unknown[]) => { auditCalls.push(args); } },
  });

  await subject.createPage(context, { title: "Seite", content: "", tags: [] });
  await subject.updatePage(context, {
    id: PAGE_ID, expectedVersion: 1, title: "Seite 2", changeMessage: "Test",
  });
  await subject.createNote(context, { content: "Inhalt", tags: [] });
  await subject.updateNote(context, { id: NOTE_ID, title: "Notiz 2" });
  await subject.createStandardDraft(context, {
    title: "Standard", description: "Beschreibung", justification: "Begründung",
    priority: "medium", pageIds: [], rules: [],
  });

  assert.deepEqual(auditCalls.map((call) => call[1]), [
    "page.created", "page.updated", "note.created", "note.updated", "standard.created",
  ]);
  for (const call of auditCalls) {
    assert.equal(call[0], USER_ID);
    assert.equal((call[4] as Record<string, unknown>).source, "mcp");
    assert.equal((call[4] as Record<string, unknown>).tokenId, TOKEN_ID);
  }
});
