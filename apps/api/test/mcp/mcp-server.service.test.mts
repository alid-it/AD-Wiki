import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { McpServerService } from "../../dist/modules/mcp/mcp-server.service.js";

type TokenDependency = ConstructorParameters<typeof McpServerService>[0];
type AuditDependency = ConstructorParameters<typeof McpServerService>[1];
type KnowledgeDependency = ConstructorParameters<typeof McpServerService>[2];
type KnowledgeWriteDependency = ConstructorParameters<typeof McpServerService>[3];
type EvaluationDependency = ConstructorParameters<typeof McpServerService>[4];
type IntelligenceDependency = ConstructorParameters<typeof McpServerService>[5];

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_ID = "20000000-0000-4000-8000-000000000002";
const knowledgeDependency = {} as KnowledgeDependency;
const knowledgeWriteDependency = {} as KnowledgeWriteDependency;
const evaluationDependency = {} as EvaluationDependency;
const intelligenceDependency = {} as IntelligenceDependency;

interface ResponseState {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function responseMock(): { response: Response; state: ResponseState } {
  const state: ResponseState = { statusCode: 200, body: null, headers: {} };
  const target = {
    headersSent: false,
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return target;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return target;
    },
    json(body: unknown) {
      state.body = body;
      target.headersSent = true;
      return target;
    },
  };
  return { response: target as unknown as Response, state };
}

function requestMock(authorization: string | undefined, body: unknown): Request {
  return {
    headers: {
      authorization,
      "x-request-id": "request-123",
      host: "localhost:4000",
    },
    body,
    ip: "127.0.0.1",
  } as unknown as Request;
}

function verifiedAccess() {
  return {
    tokenId: TOKEN_ID,
    user: {
      id: USER_ID,
      email: "admin@ad-wiki.local",
      username: "admin",
      displayName: "Admin",
      role: "ADMIN" as const,
      isActive: true,
    },
    scopes: ["mcp:read", "pages:read"],
    expiresAt: null,
  };
}

test("fehlende Authentifizierung liefert 401", async (t) => {
  const service = new McpServerService(
    { verify: async () => null } as unknown as TokenDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    knowledgeDependency,
    knowledgeWriteDependency,
    evaluationDependency,
    intelligenceDependency,
  );
  t.after(() => service.onModuleDestroy());
  const { response, state } = responseMock();

  await service.handle(requestMock(undefined, {}), response);

  assert.equal(state.statusCode, 401);
  assert.equal(state.headers["WWW-Authenticate"], 'Bearer realm="AD-Wiki MCP", resource_metadata="http://localhost:4000/.well-known/oauth-protected-resource/mcp", scope="mcp:read mcp:write"');
  assert.deepEqual(state.body, {
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
});

test("Host- und Origin-Allowlisten blockieren DNS-Rebinding und Browser-Fremdursprünge", async (t) => {
  const service = new McpServerService(
    { verify: async () => verifiedAccess() } as unknown as TokenDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    knowledgeDependency, knowledgeWriteDependency, evaluationDependency, intelligenceDependency,
  );
  t.after(() => service.onModuleDestroy());

  const badHost = requestMock("Bearer ad_wiki_mcp_secret", {});
  badHost.headers.host = "attacker.example";
  const hostResponse = responseMock();
  await service.handle(badHost, hostResponse.response);
  assert.equal(hostResponse.state.statusCode, 403);

  const badOrigin = requestMock("Bearer ad_wiki_mcp_secret", {});
  badOrigin.headers.origin = "https://attacker.example";
  const originResponse = responseMock();
  await service.handle(badOrigin, originResponse.response);
  assert.equal(originResponse.state.statusCode, 403);
});

test("gültige Authentifizierung setzt den unverfälschten Benutzerkontext", async (t) => {
  const service = new McpServerService(
    { verify: async () => verifiedAccess() } as unknown as TokenDependency,
    { log: async () => undefined } as unknown as AuditDependency,
    knowledgeDependency,
    knowledgeWriteDependency,
    evaluationDependency,
    intelligenceDependency,
  );
  t.after(() => service.onModuleDestroy());
  let handledRequest: Request | null = null;
  Reflect.set(service, "nodeHandler", async (req: Request) => {
    handledRequest = req;
  });
  const request = requestMock("Bearer ad_wiki_mcp_secret", {
    jsonrpc: "2.0",
    method: "initialize",
  });

  await service.handle(request, responseMock().response);

  const auth = (handledRequest as Request & { auth?: { clientId?: string; scopes?: string[]; extra?: unknown } } | null)?.auth;
  assert.equal(auth?.clientId, USER_ID);
  assert.deepEqual(auth?.scopes, ["mcp:read", "pages:read"]);
  assert.deepEqual(auth?.extra, { tokenId: TOKEN_ID, userId: USER_ID, role: "ADMIN" });
});

test("tools/call wird ohne Token oder Eingaben auditiert", async (t) => {
  const auditCalls: unknown[][] = [];
  const service = new McpServerService(
    { verify: async () => verifiedAccess() } as unknown as TokenDependency,
    {
      log: async (...args: unknown[]) => {
        auditCalls.push(args);
      },
    } as unknown as AuditDependency,
    knowledgeDependency,
    knowledgeWriteDependency,
    evaluationDependency,
    intelligenceDependency,
  );
  t.after(() => service.onModuleDestroy());
  Reflect.set(service, "nodeHandler", async () => undefined);
  const secretInput = "darf-nicht-ins-audit";

  await service.handle(
    requestMock("Bearer ad_wiki_mcp_secret", {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "search_wiki", arguments: { query: secretInput } },
    }),
    responseMock().response,
  );

  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0][0], USER_ID);
  assert.equal(auditCalls[0][1], "mcp.tool_called");
  assert.equal(auditCalls[0][2], "mcp");
  const details = auditCalls[0][4] as Record<string, unknown>;
  assert.equal(details.requestId, "request-123");
  assert.equal(details.tokenId, TOKEN_ID);
  assert.equal(details.protocolMethod, "tools/call");
  assert.equal(details.toolName, "search_wiki");
  assert.equal(details.transportStatus, "handled");
  assert.equal(typeof details.durationMs, "number");
  assert.ok((details.durationMs as number) >= 0);
  assert.equal(JSON.stringify(auditCalls).includes("ad_wiki_mcp_secret"), false);
  assert.equal(JSON.stringify(auditCalls).includes(secretInput), false);
});

test("auch Ressourcen- und Protokollaufrufe werden ohne Parameter auditiert", async (t) => {
  const auditCalls: unknown[][] = [];
  const service = new McpServerService(
    { verify: async () => verifiedAccess() } as unknown as TokenDependency,
    { log: async (...args: unknown[]) => { auditCalls.push(args); } } as unknown as AuditDependency,
    knowledgeDependency,
    knowledgeWriteDependency,
    evaluationDependency,
    intelligenceDependency,
  );
  t.after(() => service.onModuleDestroy());
  Reflect.set(service, "nodeHandler", async () => undefined);
  const privateUri = "knowledge://wiki/vertraulich";

  await service.handle(
    requestMock("Bearer ad_wiki_mcp_secret", {
      jsonrpc: "2.0",
      method: "resources/read",
      params: { uri: privateUri },
    }),
    responseMock().response,
  );
  await service.handle(
    requestMock("Bearer ad_wiki_mcp_secret", { jsonrpc: "2.0", method: "tools/list" }),
    responseMock().response,
  );

  assert.equal(auditCalls.length, 2);
  assert.deepEqual(auditCalls.map((call) => call[1]), ["mcp.request", "mcp.request"]);
  assert.deepEqual(
    auditCalls.map((call) => (call[4] as Record<string, unknown>).protocolMethod),
    ["resources/read", "tools/list"],
  );
  assert.equal(JSON.stringify(auditCalls).includes(privateUri), false);
  assert.equal(JSON.stringify(auditCalls).includes("ad_wiki_mcp_secret"), false);
});

test("rate-limitierte MCP-Aktionen bleiben auditiert", async (t) => {
  const auditCalls: unknown[][] = [];
  const service = new McpServerService(
    { verify: async () => verifiedAccess() } as unknown as TokenDependency,
    { log: async (...args: unknown[]) => { auditCalls.push(args); } } as unknown as AuditDependency,
    knowledgeDependency,
    knowledgeWriteDependency,
    evaluationDependency,
    intelligenceDependency,
    { consume: async () => ({ allowed: false, limit: 10, remaining: 0, retryAfterSeconds: 5 }) } as never,
  );
  t.after(() => service.onModuleDestroy());
  const { response, state } = responseMock();

  await service.handle(
    requestMock("Bearer ad_wiki_mcp_secret", { jsonrpc: "2.0", method: "resources/list" }),
    response,
  );

  assert.equal(state.statusCode, 429);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0][1], "mcp.request");
  const details = auditCalls[0][4] as Record<string, unknown>;
  assert.equal(details.protocolMethod, "resources/list");
  assert.equal(details.transportStatus, "rate_limited");
});

test("Transportfehler werden neutral beantwortet und als solche auditiert", async (t) => {
  const auditCalls: unknown[][] = [];
  const service = new McpServerService(
    { verify: async () => verifiedAccess() } as unknown as TokenDependency,
    {
      log: async (...args: unknown[]) => {
        auditCalls.push(args);
      },
    } as unknown as AuditDependency,
    knowledgeDependency,
    knowledgeWriteDependency,
    evaluationDependency,
    intelligenceDependency,
  );
  t.after(() => service.onModuleDestroy());
  Reflect.set(service, "nodeHandler", async () => {
    throw new Error("internes Detail");
  });
  const { response, state } = responseMock();

  await service.handle(
    requestMock("Bearer ad_wiki_mcp_secret", {
      method: "tools/call",
      params: { name: "read_page" },
    }),
    response,
  );

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    jsonrpc: "2.0",
    error: { code: -32603, message: "Internal server error" },
    id: null,
  });
  assert.equal(JSON.stringify(auditCalls).includes("transport_error"), true);
  assert.equal(JSON.stringify(state.body).includes("internes Detail"), false);
});
