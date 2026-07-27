import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTransport,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { registerNotesWriteTools } from "../../dist/modules/mcp/tools/notes-write.tools.js";
import { registerStandardsWriteTools } from "../../dist/modules/mcp/tools/standards-write.tools.js";
import { registerWikiWriteTools } from "../../dist/modules/mcp/tools/wiki-write.tools.js";

type ServerDependency = Parameters<typeof registerWikiWriteTools>[0];
type KnowledgeDependency = Parameters<typeof registerWikiWriteTools>[1];

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}

interface Registration {
  name: string;
  config: Record<string, unknown>;
  callback: (input: never) => Promise<ToolResult>;
}

const USER_ID = "10000000-0000-4000-8000-000000000001";
const PAGE_ID = "30000000-0000-4000-8000-000000000003";
const NOTE_ID = "40000000-0000-4000-8000-000000000004";
const STANDARD_ID = "50000000-0000-4000-8000-000000000005";
const context = {
  userId: USER_ID,
  scopes: ["pages:create", "pages:update", "notes:create", "notes:update", "standards:create"],
};

const outputs = {
  createPage: async () => result(PAGE_ID, "wiki", "Seite", "draft", 1, "ad-wiki://wiki/seite"),
  updatePage: async () => result(PAGE_ID, "wiki", "Seite", "draft", 2, "ad-wiki://wiki/seite"),
  createNote: async () => result(NOTE_ID, "note", "Notiz", "captured", null, `ad-wiki://notes/${NOTE_ID}`),
  updateNote: async () => result(NOTE_ID, "note", "Notiz", "captured", null, `ad-wiki://notes/${NOTE_ID}`),
  createStandardDraft: async () => result(STANDARD_ID, "standard", "Standard", "draft", 1, `ad-wiki://standards/${STANDARD_ID}`),
} as unknown as KnowledgeDependency;

function result(id: string, type: "wiki" | "note" | "standard", title: string, status: string, version: number | null, uri: string) {
  return { result: { id, type, title, status, version, mcpVisible: false as const, uri }, warnings: [] };
}

function registrations(): Registration[] {
  const entries: Registration[] = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>, callback: Registration["callback"]) {
      entries.push({ name, config, callback });
    },
  } as unknown as ServerDependency;
  registerWikiWriteTools(server, outputs, context);
  registerNotesWriteTools(server, outputs, context);
  registerStandardsWriteTools(server, outputs, context);
  return entries;
}

async function request(transport: InMemoryTransport, message: JSONRPCMessage) {
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    transport.onerror = reject;
    transport.onmessage = (received) => resolve(received as Record<string, unknown>);
  });
  await transport.send(message);
  return response;
}

test("registriert fünf klar als schreibend markierte Tools", () => {
  const tools = registrations();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "create_page", "update_page", "create_note", "update_note", "create_standard_draft",
  ]);
  for (const tool of tools) {
    const annotations = tool.config.annotations as Record<string, boolean>;
    assert.equal(annotations.readOnlyHint, false);
    assert.equal(annotations.idempotentHint, false);
    assert.equal(annotations.openWorldHint, false);
    assert.ok(tool.config.description?.toString().includes("Client-Freigabe"));
    assert.ok(tool.config.inputSchema);
    assert.ok(tool.config.outputSchema);
  }
  assert.equal((tools[0].config.annotations as Record<string, boolean>).destructiveHint, false);
  assert.equal((tools[1].config.annotations as Record<string, boolean>).destructiveHint, true);
});

test("liefert für Schreibvorgänge strukturierte Antworten", async () => {
  const output = await registrations()[0].callback({ title: "Seite", content: "", tags: [] } as never);
  assert.equal(output.isError, undefined);
  assert.equal(output.structuredContent?.result instanceof Object, true);
  assert.equal(JSON.parse(output.content[0].text).result.mcpVisible, false);
});

test("MCP-Protokoll validiert expectedVersion und blendet gefährliche Eingabefelder aus", async (t) => {
  let received: Record<string, unknown> | null = null;
  const knowledge = {
    ...outputs,
    updatePage: async (_context: unknown, input: Record<string, unknown>) => {
      received = input;
      return result(PAGE_ID, "wiki", "Neu", "draft", 2, "ad-wiki://wiki/seite");
    },
  } as unknown as KnowledgeDependency;
  const server = new McpServer(
    { name: "write-tools-test", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerWikiWriteTools(server as unknown as ServerDependency, knowledge, context);
  registerNotesWriteTools(server as unknown as ServerDependency, knowledge, context);
  registerStandardsWriteTools(server as unknown as ServerDependency, knowledge, context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  t.after(async () => { await clientTransport.close(); await server.close(); });
  await request(clientTransport, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const invalid = await request(clientTransport, {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "update_page", arguments: { id: PAGE_ID, title: "Neu", changeMessage: "Test" } },
  });
  assert.equal((invalid.result as { isError: boolean }).isError, true);

  await request(clientTransport, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: {
      name: "update_page",
      arguments: {
        id: PAGE_ID, expectedVersion: 1, title: "Neu", changeMessage: "Test",
        status: "published", mcpVisible: true, isPublic: true,
      },
    },
  });
  const parsedInput = received as Record<string, unknown> | null;
  assert.equal(parsedInput?.expectedVersion, 1);
  assert.equal("status" in (parsedInput ?? {}), false);
  assert.equal("mcpVisible" in (parsedInput ?? {}), false);
  assert.equal("isPublic" in (parsedInput ?? {}), false);
});
