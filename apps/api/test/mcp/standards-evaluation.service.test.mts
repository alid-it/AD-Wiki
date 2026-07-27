import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { StandardRuleType, StandardStatus } from "@prisma/client";
import { StandardsEvaluationService } from "../../dist/modules/knowledge/standards-evaluation.service.js";

type PrismaDependency = ConstructorParameters<typeof StandardsEvaluationService>[0];
const USER_ID = "10000000-0000-4000-8000-000000000001";
const STANDARD_A = "20000000-0000-4000-8000-000000000002";
const STANDARD_B = "30000000-0000-4000-8000-000000000003";
const RULE_A = "40000000-0000-4000-8000-000000000004";
const RULE_B = "50000000-0000-4000-8000-000000000005";
const context = { userId: USER_ID, scopes: ["standards:read"] };

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: RULE_A, title: "VM-Basis", type: StandardRuleType.MUST,
    minVcpu: 2, minRamMb: 8192, backupRequired: true,
    allowedPorts: [443], allowedNetworks: ["10.0.0.0/8"],
    namingConvention: "^vm-[a-z0-9-]+$", ...overrides,
  };
}

function standard(id = STANDARD_A, rules = [rule()]) {
  return {
    id, title: id === STANDARD_A ? "VM-Standard A" : "VM-Standard B",
    status: StandardStatus.ACTIVE, version: 2,
    updatedAt: new Date("2026-07-14T20:00:00.000Z"), categoryId: null, rules,
  };
}

test("wertet strukturierte Muss-Regeln deterministisch als compliant aus", async () => {
  let query: Record<string, unknown> | null = null;
  const service = new StandardsEvaluationService({ standard: {
    findMany: async (input: Record<string, unknown>) => { query = input; return [standard()]; },
  } } as unknown as PrismaDependency);
  const output = await service.evaluate(context, {
    target: { vcpus: 4, ramMb: 16384, backupEnabled: true, ports: [443], networks: ["10.0.0.0/8"], name: "vm-web-01" },
    includeShould: true,
  });

  assert.equal(output.result, "compliant");
  assert.equal(output.checks[0].result, "pass");
  assert.equal(output.sources[0].knowledgePriority, 1);
  const where = (query as unknown as { where: Record<string, unknown> }).where;
  assert.equal(where.status, StandardStatus.ACTIVE);
  assert.equal(where.mcpVisible, true);
});

test("liefert non_compliant bei verletzter Pflicht und unknown bei fehlenden Ist-Werten", async () => {
  const service = new StandardsEvaluationService({ standard: {
    findMany: async () => [standard()],
  } } as unknown as PrismaDependency);
  const failed = await service.evaluate(context, {
    target: { vcpus: 1, ramMb: 4096, backupEnabled: false, ports: [80], networks: ["extern"], name: "falsch" },
    includeShould: true,
  });
  const unknown = await service.evaluate(context, {
    target: { ports: [], networks: [] }, includeShould: true,
  });
  assert.equal(failed.result, "non_compliant");
  assert.equal(failed.checks[0].result, "fail");
  assert.equal(unknown.result, "unknown");
  assert.equal(unknown.unknownChecks.length, 1);
});

test("nicht strukturierte Regeln und ungültige Namensmuster erfinden kein Ergebnis", async () => {
  const service = new StandardsEvaluationService({ standard: {
    findMany: async () => [standard(STANDARD_A, [
      rule({ minVcpu: null, minRamMb: null, backupRequired: null, allowedPorts: [], allowedNetworks: [], namingConvention: null }),
      rule({ id: RULE_B, minVcpu: null, minRamMb: null, backupRequired: null, allowedPorts: [], allowedNetworks: [], namingConvention: "[" }),
    ])],
  } } as unknown as PrismaDependency);
  const output = await service.evaluate(context, {
    target: { ports: [], networks: [], name: "vm-test" }, includeShould: true,
  });
  assert.equal(output.result, "unknown");
  assert.equal(output.unknownChecks.length, 2);
});

test("erkennt belegbare Konflikte zwischen zwei aktiven Richtlinien ohne automatische Priorisierung", async () => {
  const service = new StandardsEvaluationService({ standard: {
    findMany: async () => [
      standard(STANDARD_A, [rule({ backupRequired: true, minVcpu: null, minRamMb: null, allowedPorts: [], allowedNetworks: [], namingConvention: null })]),
      standard(STANDARD_B, [rule({ id: RULE_B, backupRequired: false, minVcpu: null, minRamMb: null, allowedPorts: [], allowedNetworks: [], namingConvention: null })]),
    ],
  } } as unknown as PrismaDependency);
  const output = await service.detectConflicts(context, {});
  assert.equal(output.conflicts.length, 1);
  assert.equal(output.conflicts[0].severity, "critical");
  assert.deepEqual(output.conflicts[0].sourceIds, [STANDARD_A, STANDARD_B]);
  assert.equal(output.conflicts[0].higherPrioritySourceId, null);
});

test("erzwingt standards:read vor jedem Datenbankzugriff", async () => {
  let queried = false;
  const service = new StandardsEvaluationService({ standard: {
    findMany: async () => { queried = true; return []; },
  } } as unknown as PrismaDependency);
  await assert.rejects(
    service.evaluate({ userId: USER_ID, scopes: [] }, { target: { ports: [], networks: [] }, includeShould: true }),
    ForbiddenException,
  );
  assert.equal(queried, false);
});

test("erkennt normative Widersprüche zwischen Richtlinie und sichtbarem Wiki", async () => {
  let pageQuery: Record<string, unknown> | null = null;
  const service = new StandardsEvaluationService({
    standard: { findMany: async () => [standard(STANDARD_A, [rule({ minVcpu: null, backupRequired: null, allowedPorts: [], allowedNetworks: [], namingConvention: null })])] },
    page: { findMany: async (input: Record<string, unknown>) => {
      pageQuery = input;
      return [{
        id: "60000000-0000-4000-8000-000000000006", title: "VM-Anleitung", slug: "vm-anleitung",
        status: "PUBLISHED", version: 1, updatedAt: new Date("2026-07-14T20:00:00.000Z"),
        content: "Eine VM muss mindestens 4 GB RAM besitzen.",
      }];
    } },
  } as unknown as PrismaDependency);
  const output = await service.detectConflicts(
    { userId: USER_ID, scopes: ["standards:read", "pages:read"] },
    {},
  );
  assert.equal(output.conflicts.some((conflict) => conflict.topic === "Mindest-RAM"), true);
  const conflict = output.conflicts.find((item) => item.topic === "Mindest-RAM");
  assert.equal(conflict?.higherPrioritySourceId, STANDARD_A);
  const where = (pageQuery as unknown as { where: Record<string, unknown> }).where;
  assert.equal(where.mcpVisible, true);
  assert.equal(where.deletedAt, null);
});
