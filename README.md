# AD-Wiki

[![CI](https://github.com/alid-it/AD-WIKI/actions/workflows/ci.yml/badge.svg)](https://github.com/alid-it/AD-WIKI/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alid-it/AD-WIKI?display_name=tag)](https://github.com/alid-it/AD-WIKI/releases/latest)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

> Eine moderne, selbst hostbare Wissensplattform für Wiki-Inhalte, Notizen,
> Standards und KI-gestützte Wissenszugriffe.

AD-Wiki verbindet strukturiertes Wissensmanagement mit fein abgestuften
Berechtigungen, Versionierung, sicheren Backups und einem MCP-Endpunkt für
Clients wie Codex oder Claude Code. Das Projekt ist ein strikt typisiertes
TypeScript-Monorepo und wird als Docker-Compose-Stack veröffentlicht.

Aktuelles Release: **[neueste stabile Version](https://github.com/alid-it/AD-Wiki/releases/latest)**

## Funktionsumfang

### Wissen erstellen und organisieren

- Hierarchie aus Bereichen, Kategorien, Ordnern und Seiten
- WYSIWYG-Editor auf Basis von Tiptap sowie Markdown-Unterstützung
- Entwürfe, Veröffentlichung, Papierkorb und Seitenversionen mit Vergleich
- Tags, Bookmarks, Medienverwaltung und geschützte Datei-Streams
- Globale Suche, verwandte Inhalte und grafische Seitenbeziehungen
- Persönliche und freigegebene Notizen
- Richtlinien und Standards mit Regeln, Versionen und Ausnahmen
- Export als Markdown, PDF und ZIP

### Identitäten und Berechtigungen

- Lokale Anmeldung mit Access-/Refresh-Token-Rotation
- Rollen und individuelle Benutzer-Overrides
- Gruppen, Gruppenmanager und Mitgliedschaftsrollen
- Knowledge Spaces und vererbbare Ressourcen-ACLs
- OIDC-/SSO-Provider inklusive Microsoft Entra ID
- JIT-Provisionierung sowie externe Gruppen- und Rollenzuordnungen
- Audit-Logs, API-Keys und geschütztes initiales Administratorkonto

### MCP und Integrationen

- MCP über Streamable HTTP mit OAuth 2.1 und PKCE
- Wissenssuche, Lesen, Schreiben und Qualitätswerkzeuge
- Ressourcen- und Rechteprüfung vor jedem MCP-Datenzugriff
- Tokenverwaltung, Rate-Limits und strukturierte Audits
- Microsoft-To-Do-Integration mit Import, Export und Synchronisierung
- SMTP-Konfiguration und sichere Passwort-Wiederherstellung

### Betrieb und Datensicherung

- Verschlüsselte Backups mit Zeitplanung und Aufbewahrung
- Lokale Pfade, Netzwerk-Mounts, SFTP und S3-kompatibler Speicher
- Prüfsummen, atomare Veröffentlichung und geführte Restore-Vorbereitung
- Systeminformationen, Readiness-/Liveness-Endpunkte und Prometheus-Metriken
- Strukturierte JSON-Logs und WebSocket-Benachrichtigungen
- Versionierte GHCR-Images, SBOM, Provenance und automatisierte CI/CD

## Schnellstart mit Docker Compose

Für eine Installation aus einem Release werden weder das Repository noch
Node.js benötigt. Docker Engine mit Docker Compose muss installiert sein.

```bash
mkdir ad-wiki
cd ad-wiki

curl --fail --location --remote-name \
  https://github.com/alid-it/AD-Wiki/releases/latest/download/docker-compose.yml

curl --fail --location --remote-name \
  https://github.com/alid-it/AD-Wiki/releases/latest/download/env.production.example

cp env.production.example .env
nano .env
```

In `.env` müssen mindestens die öffentliche Domain, das initiale
Administratorkonto und alle leeren `AD_WIKI_*`-Secrets gesetzt werden.
Zufallswerte können unter Linux beispielsweise so erzeugt werden:

```bash
# Allgemeine Secrets
openssl rand -base64 48

# Schlüssel, die exakt 32 Byte benötigen
openssl rand -base64 32
```

Konfiguration prüfen und Stack starten:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
```

Docker Compose lädt PostgreSQL, Redis und die fest in `.env` ausgewählte
AD-Wiki-Version. `database-init` wendet vor dem API-Start automatisch alle
Prisma-Migrationen an und legt das initiale Administratorkonto idempotent an.

> **Hinweis zur Registry:** Solange die GHCR-Pakete privat sind, benötigt der
> Docker-Host einmalig `docker login ghcr.io` mit einem GitHub-Token und
> `read:packages`. Öffentliche Pakete können ohne Registry-Login geladen werden.

Weitere Informationen:

- [Produktionsbetrieb mit Docker](docs/production-docker.md)
- [CI/CD, Releases und Rollback](docs/ci-cd.md)
- [Backup und Restore](docs/backup-restore.md)

## Update und Rollback

AD-Wiki verwendet bewusst feste Versionstags statt eines unkontrollierten
`latest`-Deployments. Für ein Update wird in `.env` die gewünschte Version
gesetzt:

```env
AD_WIKI_IMAGE_TAG=v1.0.1
AD_WIKI_VERSION=1.0.1
```

Danach:

```bash
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
```

Vor einem Update sollte ein geprüftes Backup erstellt werden. Ein Rollback
erfolgt durch Rückkehr zum vorherigen Image-Tag. Bei nicht
rückwärtskompatiblen Datenbankmigrationen muss zusätzlich der dokumentierte
Restore-Ablauf berücksichtigt werden.

## Lokale Entwicklung

### Voraussetzungen

- Node.js 24
- npm 11
- Docker Desktop beziehungsweise Docker Engine mit Compose
- Git

Andere Paketmanager wie pnpm oder Yarn werden nicht unterstützt.

### Repository starten

```bash
git clone https://github.com/alid-it/AD-WIKI.git
cd AD-WIKI

npm ci

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local

docker compose up -d
npm run db:migrate
npm run dev
```

Die echten `.env`-Dateien bleiben lokal und dürfen niemals committed werden.

| Dienst | Adresse |
| --- | --- |
| Weboberfläche | `http://localhost:3000` |
| REST API | `http://localhost:4000/api/v1` |
| Swagger | `http://localhost:4000/api/docs` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| CloudBeaver | `http://localhost:8978` |

### Wichtige Befehle

```bash
# Web und API im Entwicklungsmodus
npm run dev

# Gesamtes Monorepo bauen
npm run build

# Automatisierte Sicherheits-, MCP-, Backup- und Fachtests
npm run test:mcp

# Prisma-Migration für eine Schemaänderung erstellen
npx prisma migrate dev --name beschreibung

# Prisma Studio öffnen
npm run db:studio
```

Datenbankänderungen erfolgen ausschließlich über Prisma-Migrationen.

## Architektur

```text
AD-WIKI/
├── apps/
│   ├── api/                  NestJS API, Prisma und Worker
│   └── web/                  Next.js App Router
├── packages/
│   ├── api-client/           gemeinsamer typisierter API-Client
│   ├── config/               gemeinsame TypeScript-Konfiguration
│   └── shared-types/         Zod-Schemas und TypeScript-Typen
├── docker/                   mehrstufige Produktions-Dockerfiles
├── deploy/                   quellcodefreie Release-Compose-Dateien
├── docs/                     Betriebs- und Integrationsdokumentation
└── .github/workflows/        CI und Container-Release
```

| Ebene | Technologie |
| --- | --- |
| Web | Next.js 16, React 19, Tailwind CSS 4, Tiptap |
| API | NestJS 11, TypeScript strict, Swagger |
| Verträge | Zod und `packages/shared-types` als Single Source of Truth |
| Datenbank | PostgreSQL 18, Prisma 7 mit `@prisma/adapter-pg` |
| Cache und Jobs | Redis 7 |
| Echtzeit | Socket.IO |
| Monorepo | npm Workspaces und Turborepo |
| Betrieb | Docker Compose, nginx und GitHub Actions |

Das Prisma-Schema umfasst aktuell 54 Modelle. Dazu gehören neben Wiki,
Benutzern und Sitzungen auch Notes, Standards, Spaces, Ressourcen-ACLs,
Identity Provider, OAuth, Integrationen, Backups und Audit-Daten.

## Sicherheit

- Strikte Zod-Validierung für API-Ein- und Ausgaben
- Keine untypisierten `any`-Verträge zwischen Web und API
- Gehashte Passwörter, Refresh-Tokens, API-Keys und MCP-Tokens
- Authentifizierte Verschlüsselung sensibler Integrations- und Backup-Daten
- Host-/Origin-Allowlisten, Rate-Limits und sichere Proxy-Konfiguration
- Rechteprüfung für Wiki, Notes, Standards, Spaces und MCP
- Upload-Prüfung nach tatsächlichem Dateiinhalt
- Secret-Historienprüfung in CI

Sicherheitsrelevante Produktionsdetails stehen in:

- [MCP-Betriebshandbuch](docs/mcp-operations.md)
- [SSO-Betrieb](docs/sso-betrieb.md)
- [Monitoring](docs/monitoring.md)
- [Microsoft Entra Setup](docs/entra-setup.md)

## CI/CD

Jeder Push auf `main` und jeder Pull Request durchläuft:

1. Scan der Git-Historie auf Secrets
2. Installation aus `package-lock.json`
3. Prisma-Validierung und Client-Generierung
4. alle Migrationen auf einer leeren PostgreSQL-18-Datenbank
5. Monorepo-Build und automatisierte Tests
6. Validierung des quellcodefreien Compose-Deployments
7. Build aller Produktionsimages

Ein Tag wie `v1.0.1` startet anschließend den Container-Release. Dabei werden
versionierte und unveränderliche Images nach GHCR veröffentlicht und ein
GitHub Release mit `docker-compose.yml` und `env.production.example` erstellt.

## Dokumentation

| Thema | Dokument |
| --- | --- |
| Docker-Produktion | [docs/production-docker.md](docs/production-docker.md) |
| Releases und Rollback | [docs/ci-cd.md](docs/ci-cd.md) |
| Backup und Restore | [docs/backup-restore.md](docs/backup-restore.md) |
| MCP-Betrieb | [docs/mcp-operations.md](docs/mcp-operations.md) |
| MCP mit Claude Code | [docs/MCP_Tutorial.md](docs/MCP_Tutorial.md) |
| Microsoft Entra | [docs/entra-setup.md](docs/entra-setup.md) |
| SSO-Betrieb | [docs/sso-betrieb.md](docs/sso-betrieb.md) |
| Monitoring | [docs/monitoring.md](docs/monitoring.md) |

Offene und bereits abgeschlossene technische Punkte werden in
[Bugs.md](Bugs.md) gepflegt.

## Projektstatus

AD-Wiki `v1.0.0` ist als erster versionierter Container-Release verfügbar.
Produktive Backup- und Restore-Tests für lokale Mounts, SMB und SFTP wurden
durchgeführt. Weiterführende Arbeiten und noch offene Betriebsabnahmen sind in
[Bugs.md](Bugs.md) dokumentiert.
