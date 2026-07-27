import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { CategoryScope, PageStatus, PageType } from "@prisma/client";
import { KnowledgeIntelligenceService } from "../../dist/modules/knowledge/knowledge-intelligence.service.js";

type PrismaDependency = ConstructorParameters<typeof KnowledgeIntelligenceService>[0];
type ProviderDependency = ConstructorParameters<typeof KnowledgeIntelligenceService>[1];
const USER_ID = "10000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "20000000-0000-4000-8000-000000000002";

test("klassifiziert verbindliche Inhalte lokal und markiert sensible Zugangsdaten", async () => {
  const service = new KnowledgeIntelligenceService({} as PrismaDependency);
  const output = await service.classify({ userId: USER_ID, scopes: [] }, {
    title: "VM-Richtlinie",
    content: "Jede VM muss mindestens 8 GB RAM besitzen. Client Secret darf nicht dokumentiert werden.",
  });
  assert.equal(output.result.suggestedType, "standard");
  assert.equal(output.result.sensitivity, "high");
  assert.equal(output.result.provider, "local-heuristics-v1");
  assert.ok(output.result.confidence >= 0.4 && output.result.confidence <= 1);
});

test("suggest_tags nutzt nur sichtbare Inhalte und vorhandene Tags", async () => {
  let query: Record<string, unknown> | null = null;
  const prisma = { page: { findMany: async (input: Record<string, unknown>) => {
    query = input;
    return [
      { title: "DNS-Grundlagen", content: "DNS Resolver und Zonen", tags: [{ tag: { name: "DNS" } }, { tag: { name: "Netzwerk" } }] },
      { title: "HTTP", content: "Webserver TLS", tags: [{ tag: { name: "Web" } }] },
    ];
  } } } as unknown as PrismaDependency;
  const service = new KnowledgeIntelligenceService(prisma);
  const output = await service.suggestTags(
    { userId: USER_ID, scopes: ["pages:read"] },
    { title: "DNS", content: "DNS Resolver konfigurieren", type: "wiki", limit: 5 },
  );
  assert.equal(output.results[0].name, "DNS");
  assert.equal(output.results.some((item) => item.name === "nicht-vorhanden"), false);
  const where = (query as unknown as { where: Record<string, unknown> }).where;
  assert.equal(where.type, PageType.PAGE);
  assert.equal(where.status, PageStatus.PUBLISHED);
  assert.equal(where.mcpVisible, true);
  assert.equal(where.deletedAt, null);
});

test("suggest_tags erzwingt die Read-ACL vor der Abfrage", async () => {
  let queried = false;
  const service = new KnowledgeIntelligenceService({ page: {
    findMany: async () => { queried = true; return []; },
  } } as unknown as PrismaDependency);
  await assert.rejects(
    service.suggestTags({ userId: USER_ID, scopes: [] }, { content: "DNS", type: "wiki", limit: 5 }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("suggest_category begrenzt auf den Wissenstyp und nutzt nur erlaubte Vergleichsinhalte", async () => {
  let query: Record<string, unknown> | null = null;
  const service = new KnowledgeIntelligenceService({ category: {
    findMany: async (input: Record<string, unknown>) => {
      query = input;
      return [{ id: CATEGORY_ID, name: "Netzwerk", slug: "netzwerk", description: "DNS und Routing", pages: [{ title: "DNS", content: "Resolver" }] }];
    },
  } } as unknown as PrismaDependency);
  const output = await service.suggestCategory(
    { userId: USER_ID, scopes: ["categories:read", "pages:read"] },
    { title: "DNS", content: "Resolver und Routing", type: "wiki", limit: 5 },
  );
  assert.equal(output.results[0].id, CATEGORY_ID);
  assert.equal((query as unknown as { where: { scope: CategoryScope } }).where.scope, CategoryScope.WIKI);
  const pagesWhere = (query as unknown as { select: { pages: { where: Record<string, unknown> } } }).select.pages.where;
  assert.equal(pagesWhere.mcpVisible, true);
});

test("optionaler Provider bleibt Vorschlag und fällt bei Fehler lokal zurück", async () => {
  const provider = {
    name: "test-provider",
    classify: async () => { throw new Error("offline"); },
    suggestTags: async () => [],
    suggestCategory: async () => [],
  } as unknown as ProviderDependency;
  const service = new KnowledgeIntelligenceService({} as PrismaDependency, provider);
  const output = await service.classify({ userId: USER_ID, scopes: [] }, { content: "Kurze Notiz" });
  assert.equal(output.result.provider, "local-heuristics-v1");
  assert.equal(output.warnings[0].includes("test-provider"), true);
});
