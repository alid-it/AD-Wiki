import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { registerKnowledgeResources } from "../../dist/modules/mcp/resources/knowledge.resources.js";

type ServerDependency = Parameters<typeof registerKnowledgeResources>[0];
type KnowledgeDependency = Parameters<typeof registerKnowledgeResources>[1];

const PAGE_ID = "20000000-0000-4000-8000-000000000002";
const NOTE_ID = "30000000-0000-4000-8000-000000000003";
const STANDARD_ID = "40000000-0000-4000-8000-000000000004";
const UPDATED_AT = "2026-07-14T10:00:00.000Z";

function source(type: "wiki" | "note" | "standard") {
  const id = type === "wiki" ? PAGE_ID : type === "note" ? NOTE_ID : STANDARD_ID;
  return {
    id,
    type,
    title: type === "wiki" ? "DNS-Grundlagen" : type === "note" ? "DNS-Notiz" : "DNS-Richtlinie",
    status: type === "standard" ? "active" : type === "wiki" ? "published" : "captured",
    knowledgePriority: type === "standard" ? 1 as const : type === "wiki" ? 2 as const : 3 as const,
    version: type === "note" ? null : 1,
    updatedAt: UPDATED_AT,
    uri: type === "wiki" ? "ad-wiki://wiki/dns-grundlagen" : `ad-wiki://${type === "note" ? "notes" : "standards"}/${id}`,
  };
}

function listOutput(item: ReturnType<typeof source>) {
  return {
    results: [item],
    sources: [item],
    conflicts: [],
    warnings: [],
    nextCursor: null,
  };
}

function readOutput(item: ReturnType<typeof source>) {
  return {
    result: {
      source: item,
      content: "Sichtbarer Wissensinhalt",
      excerpt: "Sichtbarer Wissensinhalt",
      category: null,
      tags: [],
      metadata: {},
    },
    sources: [item],
    conflicts: [],
    warnings: [],
  };
}

function knowledgeMock(): KnowledgeDependency {
  const wiki = source("wiki");
  const note = source("note");
  const standard = source("standard");
  return {
    listWiki: async () => listOutput(wiki),
    listNotes: async () => listOutput(note),
    listStandards: async () => listOutput(standard),
    readWiki: async (_context: unknown, reference: { slug?: string }) => {
      if (reference.slug !== "dns-grundlagen") {
        throw new NotFoundException("Wissensinhalt wurde nicht gefunden.");
      }
      return readOutput(wiki);
    },
    readNote: async () => readOutput(note),
    readStandard: async () => readOutput(standard),
  } as unknown as KnowledgeDependency;
}

async function request(
  transport: InMemoryTransport,
  message: JSONRPCMessage,
): Promise<Record<string, unknown>> {
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    transport.onerror = reject;
    transport.onmessage = (received) => resolve(received as Record<string, unknown>);
  });
  await transport.send(message);
  return response;
}

test("registriert Ressourcentemplates nur für erlaubte Wissenstypen", () => {
  const names: string[] = [];
  const server = {
    registerResource(name: string) {
      names.push(name);
    },
  } as unknown as ServerDependency;

  registerKnowledgeResources(server, knowledgeMock(), {
    userId: "10000000-0000-4000-8000-000000000001",
    scopes: ["pages:read"],
  });

  assert.deepEqual(names, ["wiki-pages"]);
});

test("listet und liest alle sichtbaren ad-wiki-Ressourcen über MCP", async (t) => {
  const server = new McpServer(
    { name: "knowledge-resources-test", version: "1.0.0" },
    { capabilities: { resources: {} } },
  );
  registerKnowledgeResources(
    server as unknown as ServerDependency,
    knowledgeMock(),
    {
      userId: "10000000-0000-4000-8000-000000000001",
      scopes: ["pages:read", "notes:read", "standards:read"],
    },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  t.after(async () => {
    await clientTransport.close();
    await server.close();
  });

  await request(clientTransport, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "knowledge-resources-test", version: "1.0.0" },
    },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const templatesResponse = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 2,
    method: "resources/templates/list",
  });
  const templates = (templatesResponse.result as {
    resourceTemplates: Array<{ uriTemplate: string }>;
  }).resourceTemplates;
  assert.deepEqual(templates.map((item) => item.uriTemplate), [
    "ad-wiki://wiki/{slug}",
    "ad-wiki://notes/{id}",
    "ad-wiki://standards/{id}",
  ]);

  const listResponse = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/list",
  });
  const resources = (listResponse.result as {
    resources: Array<{ uri: string }>;
  }).resources;
  assert.deepEqual(resources.map((item) => item.uri), [
    "ad-wiki://wiki/dns-grundlagen",
    `ad-wiki://notes/${NOTE_ID}`,
    `ad-wiki://standards/${STANDARD_ID}`,
  ]);

  const readResponse = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 4,
    method: "resources/read",
    params: { uri: "ad-wiki://wiki/dns-grundlagen" },
  });
  const contents = (readResponse.result as {
    contents: Array<{ text: string }>;
  }).contents;
  assert.match(contents[0].text, /Sichtbarer Wissensinhalt/);
  assert.match(contents[0].text, /ad-wiki:\/\/wiki\/dns-grundlagen/);

  const missingResponse = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 5,
    method: "resources/read",
    params: { uri: "ad-wiki://wiki/unsichtbar" },
  });
  const missingError = missingResponse.error as {
    code: number;
    data: { uri: string };
  };
  assert.equal(missingError.code, -32602);
  assert.deepEqual(missingError.data, { uri: "ad-wiki://wiki/unsichtbar" });
});
