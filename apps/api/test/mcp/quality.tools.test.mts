import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport, McpServer, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { registerQualityTools } from "../../dist/modules/mcp/tools/quality.tools.js";

type ServerDependency = Parameters<typeof registerQualityTools>[0];
type EvaluationDependency = Parameters<typeof registerQualityTools>[1];
type IntelligenceDependency = Parameters<typeof registerQualityTools>[2];
const USER_ID = "10000000-0000-4000-8000-000000000001";

interface Registration {
  name: string;
  config: Record<string, unknown>;
  callback: (input: never) => Promise<{ isError?: boolean; structuredContent?: Record<string, unknown> }>;
}

const evaluation = {
  evaluate: async () => ({ result: "unknown", checks: [], unknownChecks: [], sources: [], conflicts: [], warnings: [] }),
  detectConflicts: async () => ({ conflicts: [], sources: [], warnings: [] }),
} as unknown as EvaluationDependency;
const intelligence = {
  classify: async () => ({ result: { suggestedType: "note", confidence: 0.7, reason: "kurz", qualityScore: 0.4, maturityScore: 0.3, sensitivity: "low", provider: "local-heuristics-v1" }, warnings: [] }),
  suggestTags: async () => ({ results: [], warnings: [] }),
  suggestCategory: async () => ({ results: [], warnings: [] }),
} as unknown as IntelligenceDependency;
const context = { userId: USER_ID, scopes: ["standards:read", "pages:read", "categories:read"] };

function registrations(): Registration[] {
  const entries: Registration[] = [];
  const server = { registerTool(name: string, config: Record<string, unknown>, callback: Registration["callback"]) { entries.push({ name, config, callback }); } } as unknown as ServerDependency;
  registerQualityTools(server, evaluation, intelligence, context);
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

test("registriert alle fünf Phase-9d-Werkzeuge als read-only", () => {
  const tools = registrations();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "evaluate_against_standards",
    "detect_source_conflicts",
    "classify_content",
    "suggest_tags",
    "suggest_category",
  ]);
  for (const tool of tools) {
    const annotations = tool.config.annotations as Record<string, boolean>;
    assert.equal(annotations.readOnlyHint, true);
    assert.equal(annotations.destructiveHint, false);
    assert.equal(annotations.idempotentHint, true);
    assert.ok(tool.config.inputSchema);
    assert.ok(tool.config.outputSchema);
  }
  assert.equal((tools[0].config.annotations as Record<string, boolean>).openWorldHint, false);
  assert.equal((tools[2].config.annotations as Record<string, boolean>).openWorldHint, true);
});

test("routet Auswertung und Vorschläge über die gemeinsame Knowledge-Schicht", async () => {
  const tools = registrations();
  assert.equal((await tools[0].callback({ target: { ports: [], networks: [] }, includeShould: true } as never)).structuredContent?.result, "unknown");
  assert.equal(((await tools[2].callback({ content: "Notiz" } as never)).structuredContent?.result as { suggestedType: string }).suggestedType, "note");
});

test("echtes MCP-Protokoll validiert Qualitätswerkzeuge und liefert strukturierte Ausgabe", async (t) => {
  const server = new McpServer({ name: "quality-test", version: "1" }, { capabilities: { tools: {} } });
  registerQualityTools(server as unknown as ServerDependency, evaluation, intelligence, context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await clientTransport.start();
  t.after(async () => { await clientTransport.close(); await server.close(); });
  await request(clientTransport, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const valid = await request(clientTransport, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "classify_content", arguments: { content: "Kurze Notiz" } } });
  assert.equal(((valid.result as { structuredContent: { result: { suggestedType: string } } }).structuredContent.result.suggestedType), "note");
  const invalid = await request(clientTransport, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "evaluate_against_standards", arguments: { target: { ramMb: -1 } } } });
  assert.equal((invalid.result as { isError: boolean }).isError, true);
});
