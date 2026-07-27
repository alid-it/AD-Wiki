import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { registerKnowledgeTools } from "../../dist/modules/mcp/tools/knowledge.tools.js";
import { registerNotesTools } from "../../dist/modules/mcp/tools/notes.tools.js";
import { registerStandardsTools } from "../../dist/modules/mcp/tools/standards.tools.js";

type ServerDependency = Parameters<typeof registerKnowledgeTools>[0];
type KnowledgeDependency = Parameters<typeof registerKnowledgeTools>[1];

interface Registration {
  name: string;
  config: Record<string, unknown>;
  callback: (input: unknown) => Promise<{
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  }>;
}

const NOTE_ID = "30000000-0000-4000-8000-000000000003";
const STANDARD_ID = "40000000-0000-4000-8000-000000000004";
const UPDATED_AT = "2026-07-14T10:00:00.000Z";

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

function source(type: "note" | "standard") {
  return {
    id: type === "note" ? NOTE_ID : STANDARD_ID,
    type,
    title: type === "note" ? "Arbeitsnotiz" : "VM-Basisstandard",
    status: type === "note" ? "captured" : "active",
    knowledgePriority: type === "note" ? 3 as const : 1 as const,
    version: type === "note" ? null : 4,
    updatedAt: UPDATED_AT,
    uri: type === "note"
      ? `ad-wiki://notes/${NOTE_ID}`
      : `ad-wiki://standards/${STANDARD_ID}`,
  };
}

function registrations(knowledge: KnowledgeDependency): Registration[] {
  const entries: Registration[] = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>, callback: unknown) {
      entries.push({
        name,
        config,
        callback: callback as Registration["callback"],
      });
    },
  } as unknown as ServerDependency;
  const context = {
    userId: "10000000-0000-4000-8000-000000000001",
    scopes: ["pages:read", "notes:read", "standards:read"],
  };

  registerKnowledgeTools(server, knowledge, context);
  registerNotesTools(server, knowledge, context);
  registerStandardsTools(server, knowledge, context);
  return entries;
}

test("registriert die typübergreifenden Lese-Tools als read-only", () => {
  const tools = registrations({} as KnowledgeDependency);

  assert.deepEqual(tools.map((tool) => tool.name), [
    "list_knowledge",
    "search_knowledge",
    "search_notes",
    "read_note",
    "list_active_standards",
    "search_standards",
    "read_standard",
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

test("routet Notes-, Standards- und Gesamtsuche ausschließlich über KnowledgeAccessService", async () => {
  const calls: string[] = [];
  const noteSource = source("note");
  const standardSource = source("standard");
  const searchOutput = {
    results: [{ sourceId: NOTE_ID, excerpt: "Inhalt", score: 0.5 }],
    sources: [noteSource],
    conflicts: [],
    warnings: [],
    nextCursor: null,
  };
  const readOutput = (item: ReturnType<typeof source>) => ({
    result: {
      source: item,
      content: "Inhalt",
      excerpt: "Inhalt",
      category: null,
      tags: [],
      metadata: {},
    },
    sources: [item],
    conflicts: [],
    warnings: [],
  });
  const knowledge = {
    listKnowledge: async () => {
      calls.push("listKnowledge");
      return {
        results: { wiki: [], notes: [noteSource], standards: [standardSource] },
        sources: [noteSource, standardSource],
        warnings: [],
        nextCursors: { wiki: null, notes: null, standards: null },
      };
    },
    searchKnowledge: async () => { calls.push("searchKnowledge"); return searchOutput; },
    searchNotes: async () => { calls.push("searchNotes"); return searchOutput; },
    readNote: async () => { calls.push("readNote"); return readOutput(noteSource); },
    listStandards: async () => {
      calls.push("listStandards");
      return {
        results: [standardSource],
        sources: [standardSource],
        conflicts: [],
        warnings: [],
        nextCursor: null,
      };
    },
    searchStandards: async () => {
      calls.push("searchStandards");
      return { ...searchOutput, sources: [standardSource] };
    },
    readStandard: async () => {
      calls.push("readStandard");
      return readOutput(standardSource);
    },
  } as unknown as KnowledgeDependency;
  const tools = registrations(knowledge);

  await tools[0].callback({ limitPerType: 20, cursors: {} });
  await tools[1].callback({ query: "DNS", types: ["wiki"], limit: 20 });
  await tools[2].callback({ query: "DNS", limit: 20 });
  await tools[3].callback({ id: NOTE_ID });
  await tools[4].callback({ limit: 20 });
  await tools[5].callback({ query: "VM", limit: 20 });
  await tools[6].callback({ id: STANDARD_ID });

  assert.deepEqual(calls, [
    "listKnowledge",
    "searchKnowledge",
    "searchNotes",
    "readNote",
    "listStandards",
    "searchStandards",
    "readStandard",
  ]);
});

test("list_knowledge funktioniert über das echte MCP-Protokoll mit sicheren Standardwerten", async (t) => {
  let receivedInput: unknown;
  const server = new McpServer(
    { name: "knowledge-tools-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerKnowledgeTools(
    server as unknown as ServerDependency,
    {
      listKnowledge: async (_context: unknown, input: unknown) => {
        receivedInput = input;
        return {
          results: { wiki: [], notes: [], standards: [] },
          sources: [],
          warnings: [],
          nextCursors: { wiki: null, notes: null, standards: null },
        };
      },
      searchKnowledge: async () => ({
        results: [], sources: [], conflicts: [], warnings: [], nextCursor: null,
      }),
    } as unknown as KnowledgeDependency,
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
      clientInfo: { name: "knowledge-tools-test", version: "1.0.0" },
    },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const listed = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });
  assert.deepEqual(
    (listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name),
    ["list_knowledge", "search_knowledge"],
  );

  const called = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_knowledge", arguments: {} },
  });
  assert.deepEqual(receivedInput, { limitPerType: 20, cursors: {} });
  assert.deepEqual(
    (called.result as { structuredContent: { results: Record<string, unknown[]> } })
      .structuredContent.results,
    { wiki: [], notes: [], standards: [] },
  );

  const invalid = await request(clientTransport, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "list_knowledge", arguments: { limitPerType: 51 } },
  });
  assert.equal((invalid.result as { isError: boolean }).isError, true);
});
