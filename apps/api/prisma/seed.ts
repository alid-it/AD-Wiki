// Lädt die Variablen aus .env in process.env, bevor der Seed startet.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as bcrypt from "bcrypt";
import {
  PERMISSION_CATALOG,
  RESOURCES,
  type Action,
  type Resource,
} from "@ad-wiki/shared-types";

/**
 * Prisma 7 benötigt einen Driver-Adapter (kein interner Rust-Engine mehr).
 * Der PrismaPg-Adapter stellt die PostgreSQL-Verbindung über die DATABASE_URL her.
 */
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Salt-Rounds für bcrypt gemäß Sicherheitsvorgabe (siehe apps/api/CLAUDE.md). */
const SALT_ROUNDS = 12;
const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000014";

/**
 * Legt sämtliche Testdaten idempotent an.
 * Durch die Verwendung von `upsert` kann der Seed beliebig oft laufen,
 * ohne Duplikate zu erzeugen oder an Unique-Constraints zu scheitern.
 */
async function main(): Promise<void> {
  // ── 1. Rollen ─────────────────────────────────────────────
  const [adminRole, editorRole, viewerRole] = await Promise.all([
    prisma.role.upsert({
      where: { name: "admin" },
      update: {},
      create: {
        name: "admin",
        description: "Vollzugriff auf alle Ressourcen",
        isSystem: true,
      },
    }),
    prisma.role.upsert({
      where: { name: "editor" },
      update: {},
      create: {
        name: "editor",
        description: "Darf Inhalte erstellen und bearbeiten",
        isSystem: true,
      },
    }),
    prisma.role.upsert({
      where: { name: "viewer" },
      update: {},
      create: {
        name: "viewer",
        description: "Nur-Lese-Zugriff auf veröffentlichte Inhalte",
        isSystem: true,
      },
    }),
  ]);

  const permissions: Array<[typeof adminRole, string, string]> = [
    ...RESOURCES.flatMap((resource: Resource) =>
      PERMISSION_CATALOG[resource].map(
        (action: Action) => [adminRole, resource, action] as [typeof adminRole, string, string],
      ),
    ),
    ...[["pages", "create"], ["pages", "read"], ["pages", "update"], ["categories", "read"], ["spaces", "read"], ["media", "create"], ["media", "read"], ["media", "delete"], ["notes", "create"], ["notes", "read"], ["notes", "update"], ["notes", "delete"], ["notes", "share"], ["standards", "create"], ["standards", "read"], ["standards", "update"], ["mcp", "create"], ["mcp", "read"], ["mcp", "delete"]]
      .map(([resource, action]) => [editorRole, resource, action] as [typeof adminRole, string, string]),
    ...[["integrations", "create"], ["integrations", "read"], ["integrations", "update"], ["integrations", "delete"]].map(([resource, action]) => [editorRole, resource, action] as [typeof adminRole, string, string]),
    ...[["pages", "read"], ["categories", "read"], ["spaces", "read"], ["media", "read"], ["notes", "create"], ["notes", "read"], ["notes", "update"], ["notes", "delete"], ["notes", "share"], ["standards", "read"], ["mcp", "create"], ["mcp", "read"], ["mcp", "delete"]]
      .map(([resource, action]) => [viewerRole, resource, action] as [typeof adminRole, string, string]),
    ...[["integrations", "create"], ["integrations", "read"], ["integrations", "update"], ["integrations", "delete"]].map(([resource, action]) => [viewerRole, resource, action] as [typeof adminRole, string, string]),
  ];
  await Promise.all(permissions.map(([role, resource, action]) => prisma.acl.upsert({
    where: { roleId_resource_action: { roleId: role.id, resource, action } }, update: { allowed: true },
    create: { roleId: role.id, resource, action, allowed: true },
  })));

  // ── 2. Admin-User ─────────────────────────────────────────
  const passwordHash = await bcrypt.hash("admin123", SALT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email: "admin@ad-wiki.local" },
    update: {},
    create: {
      email: "admin@ad-wiki.local",
      username: "admin",
      displayName: "Administrator",
      password: passwordHash,
      roleId: adminRole.id,
    },
  });

  // ── 3. Kategorien ─────────────────────────────────────────
  await prisma.knowledgeSpace.upsert({
    where: { id: DEFAULT_SPACE_ID },
    update: {
      enabledKinds: ["WIKI", "NOTE", "STANDARD"],
      visibility: "OPEN",
      isSystem: true,
    },
    create: {
      id: DEFAULT_SPACE_ID,
      name: "Allgemein",
      slug: "allgemein",
      description: "Offener Standardbereich für bestehende Wissensinhalte",
      visibility: "OPEN",
      enabledKinds: ["WIKI", "NOTE", "STANDARD"],
      isSystem: true,
    },
  });

  const [netzwerk] = await Promise.all([
    prisma.category.upsert({
      where: { spaceId_scope_slug: { spaceId: DEFAULT_SPACE_ID, scope: "WIKI", slug: "netzwerk" } },
      update: { spaceId: DEFAULT_SPACE_ID },
      create: { spaceId: DEFAULT_SPACE_ID, name: "Netzwerk", slug: "netzwerk", icon: "network", sortOrder: 1 },
    }),
    prisma.category.upsert({
      where: { spaceId_scope_slug: { spaceId: DEFAULT_SPACE_ID, scope: "WIKI", slug: "sicherheit" } },
      update: { spaceId: DEFAULT_SPACE_ID },
      create: { spaceId: DEFAULT_SPACE_ID, name: "Sicherheit", slug: "sicherheit", icon: "shield", sortOrder: 2 },
    }),
    prisma.category.upsert({
      where: { spaceId_scope_slug: { spaceId: DEFAULT_SPACE_ID, scope: "WIKI", slug: "server" } },
      update: { spaceId: DEFAULT_SPACE_ID },
      create: { spaceId: DEFAULT_SPACE_ID, name: "Server", slug: "server", icon: "server", sortOrder: 3 },
    }),
    prisma.category.upsert({
      where: { spaceId_scope_slug: { spaceId: DEFAULT_SPACE_ID, scope: "WIKI", slug: "zertifikate" } },
      update: { spaceId: DEFAULT_SPACE_ID },
      create: { spaceId: DEFAULT_SPACE_ID, name: "Zertifikate", slug: "zertifikate", icon: "certificate", sortOrder: 4 },
    }),
  ]);

  // ── 4. Tags ───────────────────────────────────────────────
  const [tagGrundlagen, tagTroubleshooting] = await Promise.all([
    prisma.tag.upsert({
      where: { slug: "grundlagen" },
      update: {},
      create: { name: "Grundlagen", slug: "grundlagen", color: "#2563EB" },
    }),
    prisma.tag.upsert({
      where: { slug: "troubleshooting" },
      update: {},
      create: { name: "Troubleshooting", slug: "troubleshooting", color: "#F97316" },
    }),
  ]);

  // ── 5. Seiten & Ordner unter "Netzwerk" ───────────────────

  // Ordner "DNS"
  const dnsFolder = await prisma.page.upsert({
    where: { slug: "dns" },
    update: {},
    create: {
      spaceId: DEFAULT_SPACE_ID,
      title: "DNS",
      slug: "dns",
      type: "FOLDER",
      authorId: admin.id,
      categoryId: netzwerk.id,
      sortOrder: 1,
    },
  });

  // Seite "DNS Grundlagen" (im Ordner DNS)
  const dnsGrundlagen = await prisma.page.upsert({
    where: { slug: "dns-grundlagen" },
    update: {},
    create: {
      spaceId: DEFAULT_SPACE_ID,
      title: "DNS Grundlagen",
      slug: "dns-grundlagen",
      type: "PAGE",
      status: "PUBLISHED",
      authorId: admin.id,
      categoryId: netzwerk.id,
      parentId: dnsFolder.id,
      excerpt: "Wie das Domain Name System Namen in IP-Adressen auflöst.",
      content: [
        "# DNS Grundlagen",
        "",
        "Das **Domain Name System (DNS)** übersetzt menschenlesbare Namen",
        "wie `wiki.ad-wiki.local` in IP-Adressen.",
        "",
        "## Record-Typen",
        "",
        "- **A** – IPv4-Adresse",
        "- **AAAA** – IPv6-Adresse",
        "- **CNAME** – Alias auf einen anderen Namen",
        "- **MX** – Mailserver einer Domain",
        "",
        "> Die Auflösung erfolgt rekursiv über mehrere Nameserver.",
      ].join("\n"),
      sortOrder: 1,
    },
  });

  // Seite "DNS Troubleshooting" (im Ordner DNS)
  const dnsTroubleshooting = await prisma.page.upsert({
    where: { slug: "dns-troubleshooting" },
    update: {},
    create: {
      spaceId: DEFAULT_SPACE_ID,
      title: "DNS Troubleshooting",
      slug: "dns-troubleshooting",
      type: "PAGE",
      status: "PUBLISHED",
      authorId: admin.id,
      categoryId: netzwerk.id,
      parentId: dnsFolder.id,
      excerpt: "Häufige DNS-Probleme systematisch eingrenzen.",
      content: [
        "# DNS Troubleshooting",
        "",
        "## Erste Schritte",
        "",
        "1. Erreichbarkeit des Nameservers prüfen: `ping 8.8.8.8`",
        "2. Auflösung testen: `nslookup wiki.ad-wiki.local`",
        "3. Cache leeren: `ipconfig /flushdns`",
        "",
        "## Typische Ursachen",
        "",
        "- Falsche Nameserver-Einträge",
        "- Abgelaufene TTL / Caching-Probleme",
        "- Firewall blockiert Port 53",
      ].join("\n"),
      sortOrder: 2,
    },
  });

  // Ordner "DHCP"
  await prisma.page.upsert({
    where: { slug: "dhcp" },
    update: {},
    create: {
      spaceId: DEFAULT_SPACE_ID,
      title: "DHCP",
      slug: "dhcp",
      type: "FOLDER",
      authorId: admin.id,
      categoryId: netzwerk.id,
      sortOrder: 2,
    },
  });

  // Seite "VPN Konfiguration" (direkt in der Kategorie, ohne Ordner)
  await prisma.page.upsert({
    where: { slug: "vpn-konfiguration" },
    update: {},
    create: {
      spaceId: DEFAULT_SPACE_ID,
      title: "VPN Konfiguration",
      slug: "vpn-konfiguration",
      type: "PAGE",
      status: "PUBLISHED",
      authorId: admin.id,
      categoryId: netzwerk.id,
      excerpt: "Einrichtung eines sicheren VPN-Zugangs.",
      content: [
        "# VPN Konfiguration",
        "",
        "Ein **VPN** stellt einen verschlüsselten Tunnel zwischen Client",
        "und Firmennetz her.",
        "",
        "## Voraussetzungen",
        "",
        "- Gültiges Client-Zertifikat",
        "- Zugangsdaten des Benutzers",
        "- Erreichbarer VPN-Gateway",
      ].join("\n"),
      sortOrder: 3,
    },
  });

  // ── 6. Tags mit Seiten verknüpfen ─────────────────────────
  await Promise.all([
    prisma.tagsOnPages.upsert({
      where: { pageId_tagId: { pageId: dnsGrundlagen.id, tagId: tagGrundlagen.id } },
      update: {},
      create: { pageId: dnsGrundlagen.id, tagId: tagGrundlagen.id },
    }),
    prisma.tagsOnPages.upsert({
      where: { pageId_tagId: { pageId: dnsTroubleshooting.id, tagId: tagTroubleshooting.id } },
      update: {},
      create: { pageId: dnsTroubleshooting.id, tagId: tagTroubleshooting.id },
    }),
  ]);

  console.log("✔ Seed erfolgreich abgeschlossen.");
}

main()
  .catch((error) => {
    console.error("Seed fehlgeschlagen:", error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
