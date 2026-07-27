import assert from "node:assert/strict";
import test from "node:test";
import { InternalServerErrorException } from "@nestjs/common";
import { ExternalItemSyncDirection, IntegrationConnectionStatus, IntegrationProvider, NoteStatus } from "@prisma/client";
import { IntegrationEncryptionService } from "../../dist/modules/integrations/integration-encryption.service.js";
import { MicrosoftGraphService } from "../../dist/modules/integrations/microsoft-graph.service.js";
import { MicrosoftIntegrationService } from "../../dist/modules/integrations/microsoft-integration.service.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONNECTION_ID = "20000000-0000-4000-8000-000000000002";
const NOTE_ID = "30000000-0000-4000-8000-000000000003";

type PrismaDependency = ConstructorParameters<typeof MicrosoftIntegrationService>[0];
type EncryptionDependency = ConstructorParameters<typeof MicrosoftIntegrationService>[1];
type GraphDependency = ConstructorParameters<typeof MicrosoftIntegrationService>[2];
type AuditDependency = ConstructorParameters<typeof MicrosoftIntegrationService>[3];
type NotificationDependency = ConstructorParameters<typeof MicrosoftIntegrationService>[4];

function subject(prisma: unknown): MicrosoftIntegrationService {
  return new MicrosoftIntegrationService(
    prisma as PrismaDependency,
    {} as EncryptionDependency,
    {} as GraphDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    { notifyNoteChanged: () => undefined } as unknown as NotificationDependency,
  );
}

test("Microsoft-To-Do-Abfragen vermeiden das vom Graph-Backend abgelehnte $select", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const graph = new MicrosoftGraphService();
  await graph.listTodoLists("secret-token");
  await graph.listTasks("secret-token", "list/id");
  assert.equal(urls.length, 2);
  assert.equal(urls.every((url) => !url.includes("$select")), true);
  assert.match(urls[1], /\/me\/todo\/lists\/list%2Fid\/tasks$/);
});

test("Graph-Export erstellt eine Textaufgabe in der gewählten Liste", async (t) => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ id: "external-task-1", title: "DNS prüfen" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  const graph = new MicrosoftGraphService();
  const task = await graph.createTask("secret-token", "list/id", {
    title: "DNS prüfen",
    body: { contentType: "text", content: "Resolver kontrollieren" },
  });
  assert.equal(task.id, "external-task-1");
  assert.match(requestUrl, /\/me\/todo\/lists\/list%2Fid\/tasks$/);
  assert.equal(requestInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    title: "DNS prüfen",
    body: { contentType: "text", content: "Resolver kontrollieren" },
  });
});

test("Graph-Autosync aktualisiert eine bestehende Aufgabe per PATCH", async (t) => {
  let requestInit: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    requestInit = init;
    return new Response(JSON.stringify({ id: "external-task-1", title: "DNS geändert", body: { contentType: "text", content: "Neuer Inhalt" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const graph = new MicrosoftGraphService();
  await graph.updateTask("secret-token", "list-1", "external-task-1", {
    title: "DNS geändert",
    body: { contentType: "text", content: "Neuer Inhalt" },
  });
  assert.equal(requestInit?.method, "PATCH");
  assert.equal((JSON.parse(String(requestInit?.body)) as { title: string }).title, "DNS geändert");
});

test("Integrationsverschlüsselung nutzt 32-Byte-Key, Zufalls-IV und Authentifizierung", () => {
  const previous = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const encryption = new IntegrationEncryptionService();
    const first = encryption.encrypt("sensibler MSAL-Cache");
    const second = encryption.encrypt("sensibler MSAL-Cache");
    assert.notEqual(first, second);
    assert.equal(encryption.decrypt(first), "sensibler MSAL-Cache");
    const segments = first.split(".");
    const tag = Buffer.from(segments[2], "base64url");
    tag[0] ^= 1;
    segments[2] = tag.toString("base64url");
    const tampered = segments.join(".");
    assert.throws(() => encryption.decrypt(tampered), InternalServerErrorException);
  } finally {
    if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = previous;
  }
});

test("Statusabfrage ist strikt auf Benutzer und Provider begrenzt", async () => {
  let where: unknown;
  const service = subject({ integrationConnection: {
    findUnique: async (input: { where: unknown }) => { where = input.where; return null; },
  } });
  const result = await service.status(USER_ID);
  assert.deepEqual(where, { userId_provider: { userId: USER_ID, provider: IntegrationProvider.MICROSOFT_TODO } });
  assert.equal(result.connected, false);
  assert.equal(result.status, "disconnected");
});

test("bereits importierte externe Aufgaben werden dedupliziert", async () => {
  let noteCreated = false;
  let mappingTouched = false;
  const tx = {
    externalItemMapping: {
      findUnique: async () => ({ id: "mapping-1" }),
      update: async () => { mappingTouched = true; return {}; },
    },
    note: { create: async () => { noteCreated = true; return { id: NOTE_ID }; } },
  };
  const service = subject({ $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) });
  const imported = await (service as unknown as {
    importTask: (connectionId: string, userId: string, listId: string, listName: string, task: { id: string; title: string }) => Promise<boolean>;
  }).importTask(CONNECTION_ID, USER_ID, "list-1", "Aufgaben", { id: "task-1", title: "Schon da" });
  assert.equal(imported, false);
  assert.equal(noteCreated, false);
  assert.equal(mappingTouched, true);
});

test("neue Aufgaben werden als private Inbox-Notizen samt Mapping angelegt", async () => {
  let noteData: Record<string, unknown> | undefined;
  let mappingData: Record<string, unknown> | undefined;
  const tx = {
    externalItemMapping: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { mappingData = data; return {}; },
    },
    note: {
      create: async ({ data }: { data: Record<string, unknown> }) => { noteData = data; return { id: NOTE_ID, title: data.title, content: data.content, ownerId: USER_ID, updatedAt: new Date("2026-07-15T00:00:00.000Z") }; },
    },
  };
  const service = subject({ $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) });
  const imported = await (service as unknown as {
    importTask: (connectionId: string, userId: string, listId: string, listName: string, task: { id: string; title: string; status: string }) => Promise<boolean>;
  }).importTask(CONNECTION_ID, USER_ID, "list-1", "Inbox", { id: "task-2", title: "DNS prüfen", status: "notStarted" });
  assert.equal(imported, true);
  assert.equal(noteData?.ownerId, USER_ID);
  assert.equal(noteData?.status, NoteStatus.CAPTURED);
  assert.equal(noteData?.mcpVisible, false);
  assert.equal(noteData?.content, "DNS prüfen");
  assert.equal(mappingData?.connectionId, CONNECTION_ID);
  assert.equal(mappingData?.externalId, "task-2");
  assert.equal(mappingData?.localResourceId, NOTE_ID);
  assert.equal(mappingData?.direction, ExternalItemSyncDirection.IMPORT);
  assert.equal(typeof mappingData?.lastLocalHash, "string");
  assert.equal(typeof mappingData?.lastExternalHash, "string");
});

test("eigene WYSIWYG-Notiz wird als HTML-To-Do-Aufgabe exportiert und gemappt", async () => {
  const connection = {
    id: CONNECTION_ID,
    userId: USER_ID,
    provider: IntegrationProvider.MICROSOFT_TODO,
    encryptedTokenCache: "encrypted",
    scopes: ["Tasks.ReadWrite"],
    status: IntegrationConnectionStatus.ACTIVE,
    externalAccountId: "account-1",
    externalAccountName: "user@example.test",
    selectedListIds: ["list-1"],
    expiresAt: null,
    lastSyncedAt: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
  };
  let noteWhere: unknown;
  let mappingData: Record<string, unknown> | undefined;
  let graphTask: unknown;
  const prisma = {
    integrationConnection: { findUnique: async () => connection },
    note: { findFirst: async ({ where }: { where: unknown }) => { noteWhere = where; return { id: NOTE_ID, title: "DNS prüfen", content: "<p>Resolver kontrollieren</p>" }; } },
    externalItemMapping: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        mappingData = data;
        return { id: "40000000-0000-4000-8000-000000000004", createdAt: new Date("2026-07-15T00:01:00.000Z") };
      },
    },
  };
  const graph = {
    listTodoLists: async () => [{ id: "list-1", displayName: "Inbox" }],
    createTask: async (_token: string, _listId: string, task: unknown) => { graphTask = task; return { id: "external-task-1" }; },
    deleteTask: async () => undefined,
  };
  const service = new MicrosoftIntegrationService(
    prisma as unknown as PrismaDependency,
    {} as EncryptionDependency,
    graph as unknown as GraphDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    { notifyNoteChanged: () => undefined } as unknown as NotificationDependency,
  );
  (service as unknown as { accessToken: () => Promise<string> }).accessToken = async () => "token";
  const result = await service.exportNote(USER_ID, NOTE_ID, "list-1");
  assert.deepEqual(noteWhere, { id: NOTE_ID, ownerId: USER_ID, deletedAt: null });
  assert.deepEqual(graphTask, {
    title: "DNS prüfen",
    body: { contentType: "html", content: "<p>Resolver kontrollieren</p>" },
  });
  assert.equal(mappingData?.direction, ExternalItemSyncDirection.EXPORT);
  assert.equal(mappingData?.localResourceId, NOTE_ID);
  assert.equal(result.externalTaskId, "external-task-1");
});

test("endgültiges Löschen trennt lokal oder löscht auf Wunsch auch die To-Do-Aufgabe", async (t) => {
  for (const deleteExternal of [false, true]) {
    await t.test(deleteExternal ? "beide löschen" : "nur lokale Notiz", async () => {
      let graphDeleted = false;
      let mappingDeleted = false;
      let detached = false;
      const connection = {
        id: CONNECTION_ID,
        userId: USER_ID,
        provider: IntegrationProvider.MICROSOFT_TODO,
        encryptedTokenCache: "encrypted",
        scopes: ["Tasks.ReadWrite"],
        status: IntegrationConnectionStatus.ACTIVE,
        externalAccountId: "account-1",
        externalAccountName: null,
        selectedListIds: ["list-1"],
        expiresAt: null,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const prisma = {
        integrationConnection: { findUnique: async () => connection },
        externalItemMapping: {
          findUnique: async () => ({ id: "mapping-1", externalId: "task-1", externalListId: "list-1", externalDeletedAt: null, detachedAt: null }),
          delete: async () => { mappingDeleted = true; return {}; },
          update: async () => { detached = true; return {}; },
        },
      };
      const service = new MicrosoftIntegrationService(
        prisma as unknown as PrismaDependency,
        {} as EncryptionDependency,
        { deleteTask: async () => { graphDeleted = true; } } as unknown as GraphDependency,
        { log: async () => undefined } as unknown as AuditDependency,
        { notifyNoteChanged: () => undefined } as unknown as NotificationDependency,
      );
      (service as unknown as { accessToken: () => Promise<string> }).accessToken = async () => "token";
      await service.handlePermanentNoteDeletion(USER_ID, NOTE_ID, deleteExternal);
      assert.equal(graphDeleted, deleteExternal);
      assert.equal(mappingDeleted, deleteExternal);
      assert.equal(detached, !deleteExternal);
    });
  }
});
