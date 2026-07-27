import assert from "node:assert/strict";

type JsonRecord = Record<string, unknown>;

interface AuthResult {
  accessToken: string;
}

interface Identified {
  id: string;
}

interface Slugged extends Identified {
  slug: string;
}

interface RoleOverview {
  roles: Array<{ roleId: string; roleName: string }>;
}

interface AccessDecision {
  allowed: boolean;
  reason: string;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string;
  body?: unknown;
}

const apiBase = (process.env.PHASE14_API_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const adminEmail = process.env.PHASE14_ADMIN_EMAIL ?? "admin@ad-wiki.local";
const adminPassword = process.env.PHASE14_ADMIN_PASSWORD ?? "admin123";
const suffix = process.env.PHASE14_RUN_ID ?? Date.now().toString(36);
const password = `Phase14F-${suffix}-sicher`;
const checks: string[] = [];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);

  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  if (!isRecord(payload) || payload.success !== true || !("data" in payload)) {
    throw new Error(`${options.method ?? "GET"} ${path}: ungültige API-Antwort`);
  }
  return payload.data as T;
}

async function status(path: string, token: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return { status: response.status, body: await response.text() };
}

async function login(email: string): Promise<string> {
  return (
    await api<AuthResult>("/auth/login", {
      method: "POST",
      body: { email, password: email === adminEmail ? adminPassword : password },
    })
  ).accessToken;
}

function passed(label: string): void {
  checks.push(label);
}

const adminToken = await login(adminEmail);
const overview = await api<RoleOverview>("/acls", { token: adminToken });
const viewerRole = overview.roles.find((role) => role.roleName === "viewer");
assert.ok(viewerRole, "Die Seed-Rolle viewer fehlt.");

const managerRole = await api<Identified>("/roles", {
  method: "POST",
  token: adminToken,
  body: {
    name: `bereichsmanager_${suffix}`,
    description: "Temporäre Rolle für die Phase-14F-Abnahme",
  },
});
await api(`/acls/role/${managerRole.id}`, {
  method: "PUT",
  token: adminToken,
  body: [
    { resource: "pages", action: "read", allowed: true },
    { resource: "pages", action: "update", allowed: true },
    { resource: "categories", action: "read", allowed: true },
    { resource: "notes", action: "read", allowed: true },
    { resource: "standards", action: "read", allowed: true },
    { resource: "spaces", action: "read", allowed: true },
    { resource: "spaces", action: "update", allowed: true },
    { resource: "resource_acls", action: "read", allowed: true },
    { resource: "resource_acls", action: "update", allowed: true },
  ],
});

async function createUser(label: string, roleId: string): Promise<Identified & { email: string }> {
  const email = `phase14f-${label}-${suffix}@example.test`;
  const data = await api<Identified>("/users", {
    method: "POST",
    token: adminToken,
    body: {
      email,
      username: `p14${label}${suffix}`.slice(0, 50),
      displayName: `Phase 14F ${label}`,
      roleId,
      password,
      confirmPassword: password,
    },
  });
  return { ...data, email };
}

const areaManager = await createUser("manager", managerRole.id);
const groupMember = await createUser("gruppe", viewerRole.roleId);
const directUser = await createUser("direkt", viewerRole.roleId);
const overrideUser = await createUser("override", viewerRole.roleId);
const excludedUser = await createUser("ausgeschlossen", viewerRole.roleId);
const globalDeniedUser = await createUser("globaldeny", viewerRole.roleId);

const group = await api<Identified>("/groups", {
  method: "POST",
  token: adminToken,
  body: { name: `Phase 14F IT ${suffix}`, description: "Temporäre Abnahmegruppe" },
});
const foreignGroup = await api<Identified>("/groups", {
  method: "POST",
  token: adminToken,
  body: { name: `Phase 14F Fremd ${suffix}`, description: "Geschützte Vergleichsgruppe" },
});
await api(`/groups/${group.id}/members`, {
  method: "POST",
  token: adminToken,
  body: { userId: groupMember.id, role: "MANAGER" },
});
await api(`/groups/${group.id}/members`, {
  method: "POST",
  token: adminToken,
  body: { userId: overrideUser.id, role: "MEMBER" },
});

const space = await api<Identified>("/spaces", {
  method: "POST",
  token: adminToken,
  body: {
    name: `Phase 14F Geheim ${suffix}`,
    description: "Isolierter eingeschränkter Abnahmebereich",
    visibility: "restricted",
    enabledKinds: ["wiki", "note", "standard"],
    responsibleGroupId: group.id,
  },
});
const category = await api<Slugged>("/categories", {
  method: "POST",
  token: adminToken,
  body: {
    name: `Abnahme ${suffix}`,
    spaceId: space.id,
    scope: "wiki",
    description: "Kategorie für die tiefe ACL-Vererbung",
  },
});
const folder = await api<Slugged>("/pages", {
  method: "POST",
  token: adminToken,
  body: {
    title: `Abnahmeordner ${suffix}`,
    spaceId: space.id,
    categoryId: category.id,
    type: "folder",
    status: "published",
  },
});
const secretTitle = `Zugriffsmatrix ${suffix}`;
const page = await api<Slugged>("/pages", {
  method: "POST",
  token: adminToken,
  body: {
    title: secretTitle,
    content: `# Zugriffsmatrix\n\nPhase-14F-Geheimnis ${suffix}`,
    spaceId: space.id,
    categoryId: category.id,
    parentId: folder.id,
    type: "page",
    status: "published",
  },
});

async function createRule(input: JsonRecord): Promise<void> {
  await api("/resource-acls", { method: "POST", token: adminToken, body: input });
}

await createRule({
  recipientType: "group",
  recipientId: group.id,
  targetType: "space",
  targetId: space.id,
  action: "read",
  effect: "allow",
  inheritToChildren: true,
});
await createRule({
  recipientType: "user",
  recipientId: areaManager.id,
  targetType: "space",
  targetId: space.id,
  action: "read",
  effect: "allow",
  inheritToChildren: true,
});
await createRule({
  recipientType: "user",
  recipientId: areaManager.id,
  targetType: "space",
  targetId: space.id,
  action: "update",
  effect: "allow",
  inheritToChildren: true,
});
await createRule({
  recipientType: "user",
  recipientId: directUser.id,
  targetType: "page",
  targetId: page.id,
  action: "read",
  effect: "allow",
  inheritToChildren: false,
});
await createRule({
  recipientType: "user",
  recipientId: overrideUser.id,
  targetType: "page",
  targetId: page.id,
  action: "read",
  effect: "deny",
  inheritToChildren: false,
});
await createRule({
  recipientType: "user",
  recipientId: globalDeniedUser.id,
  targetType: "page",
  targetId: page.id,
  action: "read",
  effect: "allow",
  inheritToChildren: false,
});
await api(`/users/${globalDeniedUser.id}/permissions`, {
  method: "PUT",
  token: adminToken,
  body: [{ resource: "pages", action: "read", allowed: false }],
});

async function evaluate(userId: string): Promise<AccessDecision> {
  return api<AccessDecision>("/resource-acls/evaluate", {
    method: "POST",
    token: adminToken,
    body: {
      userId,
      resource: "pages",
      action: "read",
      targetType: "page",
      targetId: page.id,
    },
  });
}

const managerDecision = await evaluate(areaManager.id);
const groupDecision = await evaluate(groupMember.id);
const directDecision = await evaluate(directUser.id);
const overrideDecision = await evaluate(overrideUser.id);
const excludedDecision = await evaluate(excludedUser.id);
const globalDeniedDecision = await evaluate(globalDeniedUser.id);

assert.deepEqual(
  [
    [managerDecision.allowed, managerDecision.reason],
    [groupDecision.allowed, groupDecision.reason],
    [directDecision.allowed, directDecision.reason],
    [overrideDecision.allowed, overrideDecision.reason],
    [excludedDecision.allowed, excludedDecision.reason],
    [globalDeniedDecision.allowed, globalDeniedDecision.reason],
  ],
  [
    [true, "inherited_user_allow"],
    [true, "inherited_group_allow"],
    [true, "direct_user_allow"],
    [false, "direct_user_deny"],
    [false, "space_restricted"],
    [false, "global_denied"],
  ],
);
passed("Effektive Rechtevorschau für sechs Konflikt- und Ausschlussfälle");

const managerToken = await login(areaManager.email);
const groupToken = await login(groupMember.email);
const directToken = await login(directUser.email);
const excludedToken = await login(excludedUser.email);

assert.equal((await status(`/pages/${page.slug}`, adminToken)).status, 200);
assert.equal((await status(`/pages/${page.slug}`, managerToken)).status, 200);
assert.equal((await status(`/pages/${page.slug}`, groupToken)).status, 200);
assert.equal((await status(`/pages/${page.slug}`, directToken)).status, 200);
const excludedPage = await status(`/pages/${page.slug}`, excludedToken);
assert.equal(excludedPage.status, 404);
assert.equal(excludedPage.body.includes(page.id), false);
assert.equal(excludedPage.body.includes(secretTitle), false);
passed("Direktzugriff und verschleierte 404-Antwort ohne Metadatenleck");

const allowedSearch = await status(`/search/global?q=Zugriffsmatrix`, groupToken);
const excludedSearch = await status(`/search/global?q=Zugriffsmatrix`, excludedToken);
assert.equal(allowedSearch.status, 200);
assert.equal(allowedSearch.body.includes(page.id), true);
assert.equal(excludedSearch.status, 200);
assert.equal(excludedSearch.body.includes(page.id), false);
assert.equal(excludedSearch.body.includes(page.slug), false);
passed("Globale Suche filtert eingeschränkte Inhalte vor der Ausgabe");

const allowedGraph = await status("/pages/graph", groupToken);
const excludedGraph = await status("/pages/graph", excludedToken);
assert.equal(allowedGraph.status, 200);
assert.equal(allowedGraph.body.includes(page.id), true);
assert.equal(excludedGraph.status, 200);
assert.equal(excludedGraph.body.includes(page.id), false);
assert.equal(excludedGraph.body.includes(page.slug), false);
passed("Knowledge Graph enthält keine ausgeschlossenen Knoten");

assert.equal((await status(`/pages/${page.id}/export/markdown`, groupToken)).status, 200);
const excludedExport = await status(`/pages/${page.id}/export/markdown`, excludedToken);
assert.equal(excludedExport.status, 404);
assert.equal(excludedExport.body.includes(page.id), false);
passed("Einzelexport verwendet dieselbe Zugriffsentscheidung");

assert.equal((await status(`/groups/${group.id}/member-candidates?q=globaldeny`, groupToken)).status, 200);
assert.equal(
  (await status(`/groups/${foreignGroup.id}/member-candidates?q=globaldeny`, groupToken)).status,
  403,
);
const forbiddenManagerAppointment = await fetch(`${apiBase}/groups/${group.id}/members`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${groupToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ userId: globalDeniedUser.id, role: "MANAGER" }),
});
assert.equal(forbiddenManagerAppointment.status, 403);
passed("Lokaler Gruppenmanager bleibt auf eigene Gruppe und normale Mitglieder begrenzt");

await api(`/groups/${group.id}/members/${groupMember.id}`, {
  method: "DELETE",
  token: adminToken,
});
assert.equal((await status(`/pages/${page.slug}`, groupToken)).status, 404);
const removedMemberDecision = await evaluate(groupMember.id);
assert.equal(removedMemberDecision.allowed, false);
assert.equal(removedMemberDecision.reason, "space_restricted");
await api(`/groups/${group.id}/members`, {
  method: "POST",
  token: adminToken,
  body: { userId: groupMember.id, role: "MANAGER" },
});
assert.equal((await status(`/pages/${page.slug}`, groupToken)).status, 200);
passed("Gruppenentzug wirkt sofort und erneute Mitgliedschaft stellt Zugriff wieder her");

console.log(`Phase-14F-Live-Abnahme erfolgreich: ${checks.length} Prüfpunkte`);
for (const check of checks) console.log(`- ${check}`);
