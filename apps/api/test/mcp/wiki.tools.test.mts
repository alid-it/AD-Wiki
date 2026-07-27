import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import {
  registerWikiTools,
} from "../../dist/modules/mcp/tools/wiki.tools.js";

type ServerDependency = Parameters<typeof registerWikiTools>[0];
type KnowledgeDependency = Parameters<typeof registerWikiTools>[1];

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

interface Registration {
  name: string;
  config: Record<string, unknown>;
  callback: (input: unknown) => Promise<ToolResult>;
}

const PAGE_ID = "20000000-0000-4000-8000-000000000002";
const source = {
  id: PAGE_ID,
  type: "wiki" as const,
  title: "DNS-Grundlagen",
  status: "published",
  knowledgePriority: 2 as const,
  version: 3,
  updatedAt: "2026-07-14T10:00:00.000Z",
  uri: "ad-wiki://wiki/dns-grundlagen",
};

function registrations(knowledge: KnowledgeDependency): Registration[] {
  const entries: Registration[] = [];
  const server = {
    registerTool(
      name: string,
      config: Record<string, unknown>,
      callback: unknown,
    ) {
      entries.push({
        name,
        config,
        callback: callback as Registration["callback"],
      });
    },
  } as unknown as ServerDependency;

  registerWikiTools(server, knowledge, {
    userId: "10000000-0000-4000-8000-000000000001",
    scopes: ["pages:read"],
  });
  return entries;
}

function successfulKnowledge(): KnowledgeDependency {
  return {
    listWiki: async () => ({
      results: [source],
      sources: [source],
      conflicts: [],
      warnings: [],
      nextCursor: null,
    }),
    searchWiki: async () => ({
      results: [{ sourceId: PAGE_ID, excerpt: "DNS-Inhalt", score: 0.75 }],
      sources: [source],
      conflicts: [],
      warnings: [],
      nextCursor: null,
    }),
    readWiki: async () => ({
      result: {
        source,
        content: "DNS-Inhalt",
        excerpt: "DNS-Inhalt",
        category: null,
        tags: ["DNS"],
        metadata: { slug: "dns-grundlagen" },
      },
      sources: [source],
      conflicts: [],
      warnings: [],
    }),
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

test("registriert list_pages, search_wiki und read_page als read-only", () => {
  const tools = registrations(successfulKnowledge());

  assert.deepEqual(tools.map((tool) => tool.name), [
    "list_pages",
    "search_wiki",
    "read_page",
  ]);
  for (const tool of tools) {
    assert.deepEqual(tool.config.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.ok(tool.config.inputSchema);
    assert.ok(tool.config.outputSchema);
  }
});

test("liefert strukturierte und abwärtskompatible Textantworten", async () => {
  const tools = registrations(successfulKnowledge());
  const listResult = await tools[0].callback({ limit: 20 });
  const searchResult = await tools[1].callback({ query: "DNS", limit: 20 });
  const readResult = await tools[2].callback({ slug: "dns-grundlagen" });

  assert.equal(listResult.isError, undefined);
  assert.equal(searchResult.isError, undefined);
  assert.equal(readResult.isError, undefined);
  assert.equal(listResult.structuredContent?.sources instanceof Array, true);
  assert.equal(searchResult.structuredContent?.results instanceof Array, true);
  assert.equal(
    JSON.parse(readResult.content[0].text).result.source.id,
    PAGE_ID,
  );
});

test("funktioniert über das echte MCP-Protokoll mit Schema-Validierung", async (t) => {
  const server = new McpServer(
    { name: "wiki-tools-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerWikiTools(
    server as unknown as ServerDependency,
    successfulKnowledge(),
    { userId: "10000000-0000-4000-8000-000000000001", scopes: ["pages:read"] },
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
      clientInfo: { name: "wiki-tools-test", version: "1.0.0" },
    },
  });
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  const listed = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    "list_pages",
    "search_wiki",
    "read_page",
  ]);

  const called = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_pages", arguments: { limit: 1 } },
  });
  const result = called.result as {
    structuredContent: { sources: Array<{ id: string }> };
  };
  assert.equal(result.structuredContent.sources[0].id, PAGE_ID);

  const invalid = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "read_page", arguments: {} },
  });
  assert.equal((invalid.result as { isError: boolean }).isError, true);
});

test("gibt erwartbare Fehler verständlich und interne Fehler neutral aus", async () => {
  const expectedErrorTools = registrations({
    readWiki: async () => {
      throw new NotFoundException("Wissensinhalt wurde nicht gefunden.");
    },
  } as unknown as KnowledgeDependency);
  const expected = await expectedErrorTools[2].callback({ slug: "unsichtbar" });

  assert.equal(expected.isError, true);
  assert.equal(expected.content[0].text, "Wissensinhalt wurde nicht gefunden.");

  const internalErrorTools = registrations({
    searchWiki: async () => {
      throw new Error("Datenbankdetail darf nicht zum Client");
    },
  } as unknown as KnowledgeDependency);
  const internal = await internalErrorTools[1].callback({ query: "DNS", limit: 20 });

  assert.equal(internal.isError, true);
  assert.equal(internal.content[0].text, "Interner Tool-Fehler.");
  assert.equal(JSON.stringify(internal).includes("Datenbankdetail"), false);
});
